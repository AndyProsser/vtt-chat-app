import {
  AI_SETTING_KEYS,
  isAiSettingKey,
  setAiSetting,
  SettingError,
  validateAiSettings,
} from '@vtt-chat-app/shared';

import { MAGIC_LINK_TTL_MINUTES } from '../consts/index.js';
import type { AccountService } from '../lib/auth/accountService.js';
import type { Store } from '../lib/store/store.js';
import type { CampaignCreation, InstanceSettings, User } from '../types/index.js';

/** One line of `status`: a service, whether it answered, and a short detail. */
export interface Probe {
  name: string;
  run: () => Promise<string>;
}

export interface AdminDeps {
  store: Store;
  accounts: AccountService;
  /** Health checks for `status`. Injected so tests need no live services. */
  probes?: Probe[];
  out: (line: string) => void;
  err: (line: string) => void;
}

const SIMPLE_SETTINGS = {
  'campaign-creation': 'closed | open  (who may create campaigns)',
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
  user admin <email> grant|revoke        give or take away Admin (the last Admin cannot be removed)
  user code <email> [signin|reset]       issue a one-time code to hand over on a side channel (${MAGIC_LINK_TTL_MINUTES} min)
  user revoke-sessions <email>           sign that account out on every device
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
      case 'settings':
        return await settings(deps, command, rest);
      case 'user':
        return await users(deps, command, rest);
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
      const issued = await deps.accounts.requestMagicLink(user.email, purposeArg);
      if (!issued) throw new SettingError('could not issue a code');
      const minutes = Math.round((issued.expiresAt - Date.now()) / 60_000);
      deps.out(
        `one-time ${purposeArg} code for ${user.email} (valid about ${minutes} min, works once):`,
      );
      deps.out(issued.token);
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
        'usage: user list | admin <email> grant|revoke | code <email> [signin|reset] | revoke-sessions <email>',
      );
      return 2;
  }
}
