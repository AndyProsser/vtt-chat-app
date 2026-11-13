import {
  AI_SETTING_KEYS,
  isAiSettingKey,
  setAiSetting,
  SettingError,
  validateAiSettings,
} from '@vtt-chat-app/shared';

import {
  PROCESS_RECORDING_JOB,
  PURGE_RECORDING_JOB,
  type JobQueue,
  type RecordsStore,
} from '@vtt-chat-app/ai';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { formatBytes, freePercent, isLow, measureDisk } from '../lib/status/storage.js';
import { MAGIC_LINK_TTL_MINUTES } from '../consts/index.js';
import type { AccountService } from '../lib/auth/accountService.js';
import type { SignupService } from '../lib/auth/signupService.js';
import type { Store } from '../lib/store/store.js';
import { publishUpdates } from '../lib/updates/publish.js';
import { mirrorUsage, type SyncResult } from '../lib/updates/sync.js';
import type { CampaignCreation, InstanceSettings, User } from '../types/index.js';

/** One line of `status`: a service, whether it answered, and a short detail. */
export interface Probe {
  name: string;
  run: () => Promise<string>;
}

export interface AdminDeps {
  store: Store;
  accounts: AccountService;
  signups: SignupService;
  /** The records pipeline's queue and store (the `ai/` worker consumes the queue). */
  jobs: JobQueue;
  records: RecordsStore;
  now?: () => number;
  /** `RECORDINGS_DIR`: where raw audio is kept (unset: recordings are not kept here). */
  recordingsDir?: string;
  /** Size of the database in bytes, for `storage`. */
  databaseBytes?: () => Promise<number>;
  /** `UPDATES_DIR`: where client updates are published (unset: the `updates` commands refuse). */
  updatesDir?: string;
  /** One sync of the update feed with GitHub (`UPDATES_SOURCE`); undefined when sync is not enabled. */
  syncUpdates?: () => Promise<SyncResult | undefined>;
  /** `UPDATES_SOURCE`, for `updates status`. */
  updatesSource?: string;
  /** Health checks for `status`. Injected so tests need no live services. */
  probes?: Probe[];
  out: (line: string) => void;
  err: (line: string) => void;
}

const SIMPLE_SETTINGS = {
  'campaign-creation': 'closed | open  (who may create campaigns)',
  'signup.requests':
    'on | off  (let visitors request an account; you approve in `signup`; default off)',
  'campaign-directory':
    'on | off  (list campaigns that allow it to every signed-in account so people can ask to join; off = invites only; default on)',
  'audio-purge-next-session':
    "on | off  (when a recording starts, delete the raw audio of that campaign's earlier processed recordings; the text stays; default off)",
  'offline-limit-days': 'whole days a device may stay unseen before it must sign in again',
  'invite-expiry-days': 'whole days a new invite code stays valid',
  'consent-version':
    'version label of the "you may be recorded" text; changing it re-prompts everyone',
} as const;

const USAGE = `vtt-admin — system operations for this instance (gameplay is managed inside the app)

  status                                 health of the database, Valkey and LiveKit
  settings show                          every setting and its value
  settings keys                          every setting you can change, and what it accepts
  settings set <key> <value>             change one setting
  user list                              all accounts
  user create <email> --name <name> --accept-consent [--admin]
                                         make an account (no password; the first one is the Admin)
  user admin <email> grant|revoke        give or take away Admin (the last Admin cannot be removed)
  user code <email> [signin|reset]       issue a one-time code to hand over on a side channel (${MAGIC_LINK_TTL_MINUTES} min); a signin code also connects the app (its Connect screen's code box) when no browser is at hand
  user revoke-sessions <email>           sign that account out on every device
  signup list [pending|approved|rejected]
                                         sign-up requests from visitors (default: pending)
  signup approve <id|email>              make the account and print a one-time code to hand over on a side channel
  signup reject <id|email>               turn a request down (nothing is sent)
  storage                                disk use: recordings, free space, database size
  jobs list [queued|running|done|failed] records-pipeline jobs, newest last
  jobs retry <job-id>                    put a failed job back in the queue
  recording list                         recent recordings and their status
  recording purge <id> | --older-than <days>
                                         delete the raw audio of processed recordings (the text stays)
  recording reprocess <id> [--retranscribe]
                                         redo the summaries (and with the flag, the transcripts) from the kept audio
  updates publish <dir> --version <v> --base-url <url> [--notes <text>]
                                         publish a signed client release (the bundler's output) to UPDATES_DIR
  updates sync                           fetch the newest release of this server's line from GitHub now (UPDATES_SOURCE)
  updates status                         the update source, what players are offered, and what the mirror holds
`;

const isSimpleKey = (key: string): key is keyof typeof SIMPLE_SETTINGS => key in SIMPLE_SETTINGS;

function positiveInt(value: string, what: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new SettingError(`${what} must be a whole number of at least 1`);
  }
  return Number(value);
}

/** Applies one `settings set`, returning the new settings or throwing {@link SettingError}. */
export function applySetting(
  settings: InstanceSettings,
  key: string,
  value: string,
): InstanceSettings {
  if (isAiSettingKey(key)) return { ...settings, ai: setAiSetting(settings.ai, key, value) };
  switch (key) {
    case 'campaign-creation':
      if (value !== 'closed' && value !== 'open')
        throw new SettingError('must be "closed" or "open"');
      return { ...settings, campaignCreation: value as CampaignCreation };
    case 'signup.requests':
      if (value !== 'on' && value !== 'off') throw new SettingError('must be "on" or "off"');
      return { ...settings, signupRequests: value };
    case 'campaign-directory':
      if (value !== 'on' && value !== 'off') throw new SettingError('must be "on" or "off"');
      return { ...settings, campaignDirectory: value };
    case 'audio-purge-next-session':
      if (value !== 'on' && value !== 'off') throw new SettingError('must be "on" or "off"');
      return { ...settings, audioPurgeOnNextSession: value };
    case 'offline-limit-days':
      return { ...settings, offlineLimitDays: positiveInt(value, 'offline-limit-days') };
    case 'invite-expiry-days':
      return { ...settings, inviteExpiryDays: positiveInt(value, 'invite-expiry-days') };
    case 'consent-version':
      if (value.trim() === '') throw new SettingError('the consent version cannot be empty');
      return { ...settings, consentVersion: value.trim() };
    default:
      throw new SettingError(`unknown setting "${key}" (see: settings keys)`);
  }
}

function settingsLines(s: InstanceSettings): string[] {
  const dash = (v: string | null): string => v ?? '(none)';
  return [
    `campaign-creation          ${s.campaignCreation}`,
    `signup.requests            ${s.signupRequests}`,
    `campaign-directory         ${s.campaignDirectory}`,
    `audio-purge-next-session   ${s.audioPurgeOnNextSession}`,
    `offline-limit-days         ${s.offlineLimitDays}`,
    `invite-expiry-days         ${s.inviteExpiryDays}`,
    `consent-version            ${s.consentVersion}`,
    `ai.transcription.kind      ${s.ai.transcription.kind}`,
    `ai.transcription.url       ${dash(s.ai.transcription.url)}`,
    `ai.transcription.model     ${dash(s.ai.transcription.model)}`,
    `ai.transcription.language  ${s.ai.transcription.language}`,
    `ai.llm.kind                ${s.ai.llm.kind}`,
    `ai.llm.url                 ${dash(s.ai.llm.url)}`,
    `ai.llm.model               ${dash(s.ai.llm.model)}`,
    `ai.fallback.enabled        ${s.ai.fallback.enabled}`,
    `ai.fallback.after-seconds  ${s.ai.fallback.afterSeconds}`,
    `ai.fallback.retry-seconds  ${s.ai.fallback.retrySeconds}`,
  ];
}

/** `--name Some Words --accept-consent --admin`: the name runs until the next flag. */
function parseCreateFlags(flags: string[]): {
  name: string;
  acceptConsent: boolean;
  admin: boolean;
} {
  const words: string[] = [];
  let collecting = false;
  let acceptConsent = false;
  let admin = false;
  for (const flag of flags) {
    if (flag === '--name') collecting = true;
    else if (flag === '--accept-consent') {
      collecting = false;
      acceptConsent = true;
    } else if (flag === '--admin') {
      collecting = false;
      admin = true;
    } else if (flag.startsWith('--')) throw new SettingError(`unknown option ${flag}`);
    else if (collecting) words.push(flag);
  }
  return { name: words.join(' ').trim(), acceptConsent, admin };
}

async function findUser(deps: AdminDeps, email: string | undefined): Promise<User> {
  if (!email) throw new SettingError('an email address is required');
  const user = await deps.store.getUserByEmail(email.trim().toLowerCase());
  if (!user) throw new SettingError(`no account with the address ${email}`);
  return user;
}

/** Runs one admin command. Returns the process exit code: 0 ok, 1 failed, 2 misused. */
export async function runAdmin(argv: string[], deps: AdminDeps): Promise<number> {
  const [group, command, ...rest] = argv;
  try {
    switch (group) {
      case 'status':
        return await status(deps);
      case 'storage':
        return await storage(deps);
      case 'settings':
        return await settings(deps, command, rest);
      case 'user':
        return await users(deps, command, rest);
      case 'signup':
        return await signupRequests(deps, command, rest);
      case 'jobs':
        return await jobs(deps, command, rest);
      case 'recording':
        return await recordings(deps, command, rest);
      case 'updates':
        return await updates(deps, command, rest);
      case undefined:
      case 'help':
      case '--help':
        deps.out(USAGE);
        return group === undefined ? 2 : 0;
      default:
        deps.err(`unknown command "${group}"\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof SettingError) {
      deps.err(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

async function status(deps: AdminDeps): Promise<number> {
  let healthy = true;
  const probes: Probe[] = [
    { name: 'accounts', run: async () => `${await deps.store.countUsers()} account(s)` },
    {
      name: 'signups',
      run: async () => {
        const n = (await deps.store.listSignupRequests('pending')).length;
        return `${n} pending sign-up request(s)${n > 0 ? ' (see: signup list)' : ''}`;
      },
    },
    ...(deps.probes ?? []),
  ];
  for (const probe of probes) {
    try {
      deps.out(`ok    ${probe.name.padEnd(10)} ${await probe.run()}`);
    } catch (error) {
      healthy = false;
      deps.out(
        `FAIL  ${probe.name.padEnd(10)} ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return healthy ? 0 : 1;
}

async function settings(
  deps: AdminDeps,
  command: string | undefined,
  rest: string[],
): Promise<number> {
  const current = await deps.store.getSettings();
  switch (command) {
    case 'show':
      settingsLines(current).forEach(deps.out);
      return 0;
    case 'keys':
      for (const [key, what] of Object.entries({ ...SIMPLE_SETTINGS, ...AI_SETTING_KEYS })) {
        deps.out(`${key.padEnd(27)}${what}`);
      }
      return 0;
    case 'set': {
      const [key, ...valueParts] = rest;
      if (!key || valueParts.length === 0) {
        deps.err('usage: settings set <key> <value>');
        return 2;
      }
      if (!isSimpleKey(key) && !isAiSettingKey(key)) {
        throw new SettingError(`unknown setting "${key}" (see: settings keys)`);
      }
      const next = applySetting(current, key, valueParts.join(' '));
      await deps.store.putSettings(next);
      deps.out(`set ${key}`);
      // Saved, but say so loudly if it leaves AI processing unusable (e.g. remote without a URL).
      for (const problem of validateAiSettings(next.ai)) deps.out(`warning: ${problem}`);
      return 0;
    }
    default:
      deps.err('usage: settings show | keys | set <key> <value>');
      return 2;
  }
}

async function users(
  deps: AdminDeps,
  command: string | undefined,
  rest: string[],
): Promise<number> {
  switch (command) {
    case 'list': {
      for (const u of await deps.store.listUsers()) {
        deps.out(`${u.isAdmin ? 'admin' : 'user '}  ${u.email.padEnd(32)} ${u.displayName}`);
      }
      return 0;
    }
    case 'admin': {
      const [email, action] = rest;
      if (action !== 'grant' && action !== 'revoke') {
        deps.err('usage: user admin <email> grant|revoke');
        return 2;
      }
      const user = await findUser(deps, email);
      const grant = action === 'grant';
      if (!grant && user.isAdmin) {
        const admins = (await deps.store.listUsers()).filter((u) => u.isAdmin);
        if (admins.length <= 1) {
          throw new SettingError('that is the only Admin; grant Admin to someone else first');
        }
      }
      if (user.isAdmin === grant) {
        deps.out(`${user.email} is already ${grant ? 'an Admin' : 'not an Admin'}`);
        return 0;
      }
      await deps.store.putUser({ ...user, isAdmin: grant });
      deps.out(`${user.email} is ${grant ? 'now an Admin' : 'no longer an Admin'}`);
      return 0;
    }
    case 'code': {
      const [email, purposeArg = 'signin'] = rest;
      if (purposeArg !== 'signin' && purposeArg !== 'reset') {
        deps.err('usage: user code <email> [signin|reset]');
        return 2;
      }
      const user = await findUser(deps, email);
      const issued = await deps.accounts.requestMagicLink(user.email, purposeArg, { short: true });
      if (!issued) throw new SettingError('could not issue a code');
      const minutes = Math.round((issued.expiresAt - Date.now()) / 60_000);
      deps.out(
        `one-time ${purposeArg} code for ${user.email} (valid about ${minutes} min, works once):`,
      );
      deps.out(`${issued.token.slice(0, 4)}-${issued.token.slice(4)}`);
      return 0;
    }
    case 'create': {
      const [email, ...flags] = rest;
      const parsed = parseCreateFlags(flags);
      if (!email || !parsed.name) {
        deps.err('usage: user create <email> --name <display name> --accept-consent [--admin]');
        return 2;
      }
      if (!parsed.acceptConsent) {
        throw new SettingError(
          'creating an account records that the person has agreed to the recording notice; ' +
            'pass --accept-consent if they have (for the first account, that is you)',
        );
      }
      const settings = await deps.store.getSettings();
      let user: User;
      try {
        user = await deps.accounts.register({
          email,
          displayName: parsed.name,
          acceptedConsentVersion: settings.consentVersion,
        });
      } catch (error) {
        throw new SettingError(error instanceof Error ? error.message : String(error));
      }
      if (parsed.admin && !user.isAdmin) {
        user = { ...user, isAdmin: true };
        await deps.store.putUser(user);
      }
      await deps.accounts.ensureStarterCampaign(user);
      deps.out(
        `created ${user.email}${user.isAdmin ? ' (Admin)' : ''}; it has no password. ` +
          `Hand over a sign-in code with: user code ${user.email}`,
      );
      return 0;
    }
    case 'revoke-sessions': {
      const user = await findUser(deps, rest[0]);
      await deps.accounts.revokeAllSessions(user.id);
      deps.out(`${user.email} is signed out everywhere`);
      return 0;
    }
    default:
      deps.err(
        'usage: user list | create <email> --name <name> --accept-consent [--admin] | admin <email> grant|revoke | code <email> [signin|reset] | revoke-sessions <email>',
      );
      return 2;
  }
}

const SIGNUP_STATES = ['pending', 'approved', 'rejected'] as const;

async function signupRequests(
  deps: AdminDeps,
  command: string | undefined,
  rest: string[],
): Promise<number> {
  const asSettingError = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } catch (error) {
      throw new SettingError(error instanceof Error ? error.message : String(error));
    }
  };
  switch (command) {
    case 'list': {
      const state = rest[0] ?? 'pending';
      if (!(SIGNUP_STATES as readonly string[]).includes(state)) {
        throw new SettingError(`state must be one of ${SIGNUP_STATES.join(', ')}`);
      }
      const list = await deps.signups.list(state as (typeof SIGNUP_STATES)[number]);
      for (const r of list) {
        const when = new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ');
        const note = r.message ? `  "${r.message.replace(/\s+/g, ' ')}"` : '';
        deps.out(`${r.id}  ${when}  ${r.displayName}  <${r.email}>${note}`);
      }
      if (list.length === 0) deps.out(`no ${state} sign-up requests`);
      return 0;
    }
    case 'approve': {
      const [target] = rest;
      if (!target) {
        deps.err('usage: signup approve <id|email>');
        return 2;
      }
      const { request, token, expiresAt } = await asSettingError(deps.signups.approve(target));
      const minutes = Math.max(0, Math.round((expiresAt - Date.now()) / 60_000));
      deps.out(`approved ${request.email}`);
      deps.out(`sign-in code (valid about ${minutes} min, works once):`);
      deps.out(`${token.slice(0, 4)}-${token.slice(4)}`);
      deps.out(
        'Hand it to them on a side channel (message, in person), not by replying to the request. ' +
          `They enter it under "I have a sign-in code" and accept the recording notice. Need a new one: user code ${request.email}`,
      );
      return 0;
    }
    case 'reject': {
      const [target] = rest;
      if (!target) {
        deps.err('usage: signup reject <id|email>');
        return 2;
      }
      const request = await asSettingError(deps.signups.reject(target));
      deps.out(`rejected ${request.email}`);
      return 0;
    }
    default:
      deps.err(
        'usage: signup list [pending|approved|rejected] | approve <id|email> | reject <id|email>',
      );
      return 2;
  }
}

const JOB_STATES = ['queued', 'running', 'done', 'failed'] as const;

async function jobs(deps: AdminDeps, command: string | undefined, rest: string[]): Promise<number> {
  const now = deps.now ?? Date.now;
  switch (command) {
    case 'list': {
      const state = rest[0];
      if (state !== undefined && !(JOB_STATES as readonly string[]).includes(state)) {
        throw new SettingError(`state must be one of ${JOB_STATES.join(', ')}`);
      }
      const list = await deps.jobs.list(state ? [state as (typeof JOB_STATES)[number]] : undefined);
      for (const j of list) {
        const error = j.lastError ? `  ${j.lastError.slice(0, 80)}` : '';
        deps.out(
          `${j.id}  ${j.state.padEnd(7)} ${j.kind}  attempt ${j.attempts}/${j.maxAttempts}${error}`,
        );
      }
      if (list.length === 0) deps.out('no jobs');
      return 0;
    }
    case 'retry': {
      const id = rest[0];
      if (!id) {
        deps.err('usage: jobs retry <job-id>');
        return 2;
      }
      const job = await deps.jobs.retry(id, now());
      if (!job) throw new SettingError('no failed job with that id');
      if (job.recordingId) await deps.records.setRecordingStatus(job.recordingId, 'stopped');
      deps.out(`job ${job.id} is queued again with a fresh set of attempts`);
      return 0;
    }
    default:
      deps.err('usage: jobs list [state] | retry <job-id>');
      return 2;
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function updates(
  deps: AdminDeps,
  command: string | undefined,
  rest: string[],
): Promise<number> {
  const dir = deps.updatesDir;
  switch (command) {
    case 'publish': {
      const from = rest[0];
      const version = flag(rest, '--version');
      const baseUrl = flag(rest, '--base-url');
      if (!from || from.startsWith('--') || !version || !baseUrl) {
        deps.err(
          'usage: updates publish <dir> --version <v> --base-url <url> [--notes <text>]\n' +
            '  a version with a suffix (0.4.0-dev.2, 0.4.0-rc.1) is a dev build and goes to the dev channel\n' +
            '  <dir> is the bundler output (installers with .sig files); --base-url is where this server\n' +
            '  serves /updates, e.g. https://play.example.com/updates',
        );
        return 2;
      }
      if (!dir) {
        deps.err(
          'error: UPDATES_DIR is not set; set it to the folder the backend serves at /updates',
        );
        return 1;
      }
      const notes = flag(rest, '--notes');
      try {
        const result = await publishUpdates({
          from,
          to: dir,
          baseUrl,
          version,
          ...(notes ? { notes } : {}),
        });
        deps.out(
          `published ${version} (${result.channel === 'dev' ? 'dev build: only players who opted in to dev builds are offered it' : 'release: every player is offered it'}) for ${result.platforms.join(', ')} to ${dir}`,
        );
        return 0;
      } catch (error) {
        deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
      }
    }
    case 'sync': {
      if (!deps.syncUpdates) {
        deps.err(
          'error: update sync is off; set UPDATES_SOURCE=github (or mirror) and UPDATES_DIR',
        );
        return 1;
      }
      try {
        const r = await deps.syncUpdates();
        if (!r) {
          deps.err(
            'error: update sync is off; set UPDATES_SOURCE=github (or mirror) and UPDATES_DIR',
          );
          return 1;
        }
        deps.out(`offering ${r.release ?? 'no release'}${r.dev ? `, dev build ${r.dev}` : ''}`);
        if (r.downloaded.length) deps.out(`downloaded: ${r.downloaded.join(', ')}`);
        if (r.removed.length) deps.out(`removed old versions: ${r.removed.join(', ')}`);
        for (const s of r.skipped) deps.out(`skipped ${s}`);
        return 0;
      } catch (error) {
        deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
      }
    }
    case 'status': {
      if (!dir) {
        deps.err('error: UPDATES_DIR is not set');
        return 1;
      }
      deps.out(`source: ${deps.updatesSource ?? 'manual (vtt-admin updates publish)'}`);
      if (deps.updatesSource === 'mirror') {
        const usage = await mirrorUsage(dir);
        deps.out(
          `mirror holds: ${usage.versions.join(', ') || 'nothing yet'} (${(usage.bytes / 1_048_576).toFixed(0)} MB)`,
        );
      }
      const feeds: [string, string][] = [
        ['releases', path.join(dir, 'latest.json')],
        ['dev builds', path.join(dir, 'dev', 'latest.json')],
      ];
      let any = false;
      for (const [name, file] of feeds) {
        try {
          const latest = JSON.parse(await readFile(file, 'utf8')) as {
            version: string;
            pub_date: string;
            platforms: Record<string, unknown>;
          };
          deps.out(
            `${name}: offering ${latest.version} (${latest.pub_date}) for ${Object.keys(latest.platforms).join(', ')}`,
          );
          any = true;
        } catch {
          // this channel has nothing yet
        }
      }
      if (!any) deps.out('no update published');
      return 0;
    }
    default:
      deps.err(`unknown updates command "${command ?? ''}"\n\n${USAGE}`);
      return 2;
  }
}

async function recordings(
  deps: AdminDeps,
  command: string | undefined,
  rest: string[],
): Promise<number> {
  switch (command) {
    case 'list': {
      const list = await deps.records.listRecordings(20);
      for (const r of list) {
        const when = new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ');
        const tracks = await deps.records.listTracks(r.id);
        const purged = tracks.filter((t) => (t.purgedAt ?? null) !== null).length;
        const audio =
          tracks.length === 0
            ? ''
            : purged === 0
              ? 'audio kept'
              : purged === tracks.length
                ? 'audio purged'
                : 'audio partly purged';
        deps.out(
          `${r.id}  ${r.status.padEnd(10)} ${when}  ${tracks.length} track(s)  ${audio}`.trimEnd(),
        );
      }
      if (list.length === 0) deps.out('no recordings');
      return 0;
    }
    case 'reprocess': {
      const [id, ...flags] = rest;
      if (!id) {
        deps.err('usage: recording reprocess <recording-id> [--retranscribe]');
        return 2;
      }
      const unknown = flags.filter((f) => f !== '--retranscribe');
      if (unknown.length > 0) throw new SettingError(`unknown option ${unknown[0]}`);
      const recording = await deps.records.getRecording(id);
      if (!recording) throw new SettingError('no recording with that id');
      if (recording.status === 'recording') {
        throw new SettingError('that recording is still in progress; stop it first');
      }
      const transcripts = flags.includes('--retranscribe');
      if (
        transcripts &&
        (await deps.records.listTracks(id)).some((t) => (t.purgedAt ?? null) !== null)
      ) {
        throw new SettingError(
          'the raw audio of that recording has been purged, so it cannot be transcribed again; ' +
            'reprocess without --retranscribe to redo only the summaries',
        );
      }
      await deps.records.resetForReprocess(id, { transcripts });
      await deps.records.setRecordingStatus(id, 'stopped');
      const job = await deps.jobs.enqueue(
        { kind: PROCESS_RECORDING_JOB, recordingId: id },
        (deps.now ?? Date.now)(),
      );
      deps.out(
        `queued ${job.id}: will redo the ${transcripts ? 'transcripts and ' : ''}summaries from the kept audio`,
      );
      return 0;
    }
    case 'purge': {
      const now = (deps.now ?? Date.now)();
      if (rest[0] === '--older-than') {
        const days = positiveInt(rest[1] ?? '', 'the number of days');
        const due = await deps.records.listPurgeableRecordings(now - days * 86_400_000, 500);
        for (const r of due) {
          await deps.jobs.enqueue({ kind: PURGE_RECORDING_JOB, recordingId: r.id }, now);
        }
        deps.out(
          `queued ${due.length} purge(s) of raw audio older than ${days} day(s); the worker deletes the files`,
        );
        return 0;
      }
      const [id] = rest;
      if (!id) {
        deps.err('usage: recording purge <recording-id> | purge --older-than <days>');
        return 2;
      }
      const recording = await deps.records.getRecording(id);
      if (!recording) throw new SettingError('no recording with that id');
      if (recording.status !== 'processed') {
        throw new SettingError(
          'that recording has not been processed yet; its audio is still needed (see: recording list)',
        );
      }
      const job = await deps.jobs.enqueue({ kind: PURGE_RECORDING_JOB, recordingId: id }, now);
      deps.out(
        `queued ${job.id}: the worker will delete the raw audio and keep the transcript and summaries`,
      );
      return 0;
    }
    default:
      deps.err('usage: recording list | reprocess <recording-id> [--retranscribe] | purge <id>');
      return 2;
  }
}

async function storage(deps: AdminDeps): Promise<number> {
  if (deps.recordingsDir === undefined) {
    deps.out('recordings are not kept on this server (RECORDINGS_DIR is not set)');
  } else {
    const use = await measureDisk(deps.recordingsDir, { walk: true });
    if (!use) {
      deps.err(`cannot read ${deps.recordingsDir}`);
      return 1;
    }
    deps.out(`recordings   ${formatBytes(use.dirBytes ?? 0)}   (${deps.recordingsDir})`);
    deps.out(
      `             ${formatBytes(use.freeBytes)} free on that disk of ${formatBytes(use.totalBytes)} (${freePercent(use)}%)`,
    );
    if (isLow(use)) {
      deps.out(
        'WARNING: that disk is nearly full. Purge raw audio: recording purge --older-than 30',
      );
    }
  }
  if (deps.databaseBytes) deps.out(`database     ${formatBytes(await deps.databaseBytes())}`);
  return 0;
}
