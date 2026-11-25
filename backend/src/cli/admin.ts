import {
  AI_SETTING_KEYS,
  BARD_IDS,
  isAiSettingKey,
  setAiSetting,
  SettingError,
  validateAiSettings,
} from '@vtt-chat-app/shared';

import {
  CLAUDE_CONTEXT_WINDOWS,
  contextWindowTokens,
  DELETE_RECORDING_JOB,
  PROCESS_RECORDING_JOB,
  PURGE_RECORDING_JOB,
  type JobQueue,
  estimateClaudeCost,
  type Job,
  type LocalAiStatus,
  MEMORY_KIND_LABELS,
  type OllamaContextStatus,
  type RecordsStore,
} from '@vtt-chat-app/ai';
import {
  formatTestRows,
  testExitCode,
  testVerdict,
  type AiSettings,
  type TestRow,
} from '@vtt-chat-app/shared';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { reachTargets, type VoiceTarget, type WebTarget } from '../lib/selftest/reach.js';
import { formatBytes, freePercent, isLow, measureDisk } from '../lib/status/storage.js';
import {
  ArchiveError,
  type ImportResult,
  type UnprocessedRecording,
} from '../lib/campaigns/campaignArchive.js';
import type { AccountService } from '../lib/auth/accountService.js';
import type { SignupService } from '../lib/auth/signupService.js';
import type { Store } from '../lib/store/store.js';
import { publishUpdates } from '../lib/updates/publish.js';
import { mirrorUsage, type SyncResult } from '../lib/updates/sync.js';
import type { CampaignCreation, InstanceSettings, User } from '../types/index.js';
import { formatGroupHelp, formatHelp, wrapWords, type AdminHost } from './help.js';
import { duration, plainUi, plural, stamp, type BadgeKind, type Ui } from './ui.js';
import type { MachineInfo } from '../lib/status/machine.js';

/** One line of `status`: a service, whether it answered, and a short detail. */
export interface Probe {
  name: string;
  run: () => Promise<string>;
}

export interface AdminDeps {
  /** How output is drawn (colour, graphics, width); plain when absent, and always with `--plain`. */
  ui?: Ui;
  /** This server's version, for the `status` title. */
  version?: string;
  /** CPU, memory, load and disks, for `status`. Injected so tests need no real machine. */
  machine?: () => Promise<MachineInfo>;
  /** Which wrapper ran the CLI, for the help's "this machine" section (`VTT_ADMIN_HOST`). */
  host?: AdminHost;
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
  /**
   * `vtt-admin test`: the checks, injected because they need live services. A missing one is not available in this
   * process (AI is tested inside the worker's container on a Compose install).
   */
  selfTest?: {
    voice?: () => Promise<TestRow[]>;
    reach?: (targets: { web: WebTarget; voice: VoiceTarget }) => Promise<TestRow[]>;
    ai?: (flags: { local: boolean; remote: boolean; cloud: boolean }) => Promise<TestRow[]>;
    /** The server's public address (`PUBLIC_URL`) and voice address (`VOICE_ADDRESS`), which `test reach` asks about. */
    publicUrl?: string;
    voiceAddress?: string;
    /** The ICE-over-TCP port, when the operator changed it from LiveKit's 7881 (`VOICE_TCP_PORT`). */
    voiceTcpPort?: number;
  };
  /** What the worker last found checking Ollama's real context window, for `status`'s AI section. */
  localAi?: LocalAiStatus | null;
  /** Removes pictures and PDFs no handout uses (after a campaign is deleted); returns how many. Needs MEDIA_DIR. */
  sweepMedia?: () => Promise<number>;
  /** One campaign's export and import (`campaign export` / `import`). Needs Postgres; absent in memory tests. */
  archive?: {
    unprocessed: (campaignId: string) => Promise<UnprocessedRecording[]>;
    /** Writes the `.vttcampaign` file; resolves with its size and any handout files it could not read. */
    export: (
      campaignId: string,
      file: string,
    ) => Promise<{ bytes: number; missingMedia: string[] }>;
    import: (file: string, options: { asNew: boolean }) => Promise<ImportResult>;
  };
  /** Waits between checks while the worker removes a campaign's recordings. Injected so tests need not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** How long `campaign delete` waits for the worker (seconds). */
  campaignDeleteWaitSeconds?: number;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** What every command works with: the dependencies, and how to draw. */
type Ctx = AdminDeps & { ui: Ui };

const SIMPLE_SETTINGS = {
  'campaign-creation': 'closed | open  (who may create campaigns)',
  'signup.requests':
    'on | off  (let visitors request an account; you approve in `signup`; default off)',
  'campaign-directory':
    'on | off  (list campaigns that allow it to every signed-in account so people can ask to join; off = invites only; default on)',
  'audio-purge-next-session':
    "on | off  (when a recording starts, delete the raw audio of that campaign's earlier processed recordings; the text stays; default off)",
  'recording.max-tables':
    'how many tables may be recording at the same time (default 2; 0 = no limit). Only the start of a recording is refused past it; processing stays one job at a time',
  'offline-limit-days': 'whole days a device may stay unseen before it must sign in again',
  'invite-expiry-days': 'whole days a new invite code stays valid',
  'consent-version':
    'version label of the "you may be recorded" text; changing it re-prompts everyone',
} as const;

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
    case 'recording.max-tables':
      if (!/^\d+$/.test(value) || Number(value) > 100)
        throw new SettingError('must be a whole number from 0 (no limit) to 100');
      return { ...settings, maxRecordingTables: Number(value) };
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

/** Which section of `settings show` / `settings keys` a key belongs to, by its prefix. */
const SETTING_SECTIONS: [title: string, matches: (key: string) => boolean][] = [
  ['General', (k) => !k.startsWith('ai.')],
  ['Transcription (Whisper)', (k) => k.startsWith('ai.transcription.')],
  ['Summary model (LLM)', (k) => k.startsWith('ai.llm.')],
  ['Fallback to local AI', (k) => k.startsWith('ai.fallback.')],
  ['Processing and memory', (k) => k === 'ai.pause-while-recording' || k.startsWith('ai.memory.')],
  ['Storyteller', (k) => k.startsWith('ai.tale.') || k.startsWith('ai.storyteller')],
];

/** Every setting and its value, in `settings show` order. */
function settingValues(s: InstanceSettings): [string, string | null][] {
  return [
    ['campaign-creation', s.campaignCreation],
    ['signup.requests', s.signupRequests],
    ['campaign-directory', s.campaignDirectory],
    ['audio-purge-next-session', s.audioPurgeOnNextSession],
    ['recording.max-tables', String(s.maxRecordingTables)],
    ['offline-limit-days', String(s.offlineLimitDays)],
    ['invite-expiry-days', String(s.inviteExpiryDays)],
    ['consent-version', s.consentVersion],
    ['ai.transcription.kind', s.ai.transcription.kind],
    ['ai.transcription.url', s.ai.transcription.url],
    ['ai.transcription.model', s.ai.transcription.model],
    ['ai.transcription.language', s.ai.transcription.language],
    ['ai.transcription.glossary', s.ai.transcription.glossary],
    ['ai.llm.kind', s.ai.llm.kind],
    ['ai.llm.url', s.ai.llm.url],
    ['ai.llm.model', s.ai.llm.model],
    ['ai.llm.context', s.ai.llm.context === null ? 'none' : String(s.ai.llm.context)],
    ['ai.fallback.enabled', String(s.ai.fallback.enabled)],
    ['ai.fallback.after-seconds', String(s.ai.fallback.afterSeconds)],
    ['ai.fallback.retry-seconds', String(s.ai.fallback.retrySeconds)],
    ['ai.memory.enabled', String(s.ai.memory.enabled)],
    ['ai.pause-while-recording', String(s.ai.processing.pauseWhileRecording)],
    ['ai.tale.length', s.ai.tale.length],
    ['ai.tale.content', s.ai.tale.content],
    ...BARD_IDS.map((id): [string, string] => [
      `ai.storyteller.${id}`,
      s.ai.tale.storytellersOff.includes(id) ? 'off' : 'on',
    ]),
  ];
}

/** A value, coloured by what it means: on and off, unset, or just a value. */
function paintValue(ui: Ui, value: string | null): string {
  if (value === null) return ui.dim('(none)');
  if (['on', 'open', 'true'].includes(value)) return ui.good(value);
  if (['off', 'closed', 'false'].includes(value)) return ui.warn(value);
  return ui.accent(value);
}

/** Rows under section headings, aligned as one table so every section lines up. */
function sectioned(ui: Ui, rows: [key: string, ...cells: string[]][]): string[] {
  const lines = ui.table(rows.map(([key, ...cells]) => [ui.bold(key), ...cells]));
  const out: string[] = [];
  for (const [title, matches] of SETTING_SECTIONS) {
    const mine = rows.flatMap((row, i) => (matches(row[0]) ? [lines[i] ?? ''] : []));
    if (mine.length === 0) continue;
    out.push('', ui.section(title), ...mine);
  }
  return out;
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

async function findUser(deps: Ctx, email: string | undefined): Promise<User> {
  if (!email) throw new SettingError('an email address is required');
  const user = await deps.store.getUserByEmail(email.trim().toLowerCase());
  if (!user) throw new SettingError(`no account with the address ${email}`);
  return user;
}

/**
 * A group run with no command, or one it does not have: that group's commands, and exit 2. Without a
 * command it goes to stdout (the operator asked what the group does), with a wrong one to stderr.
 */
function misuse(deps: Ctx, group: string, command: string | undefined): void {
  const groupHelp = formatGroupHelp(group, deps.ui) ?? '';
  if (command === undefined) deps.out(groupHelp);
  else deps.err(`${deps.ui.error(`unknown ${group} command "${command}"`)}\n\n${groupHelp}`);
}

/** A one-time code, `ABCD-EFGH`, large enough to read out. */
function showCode(ui: Ui, token: string): string {
  const code = `${token.slice(0, 4)}-${token.slice(4)}`;
  return ui.unicode ? `\n    ${ui.bold(ui.accent(code))}\n` : code;
}

/** A job's or recording's state, coloured: done is green, running cyan, waiting amber, failed red. */
function paintState(ui: Ui, state: string): string {
  if (['done', 'processed'].includes(state)) return ui.good(state);
  if (['running', 'processing'].includes(state)) return ui.accent(state);
  if (state === 'recording') return ui.bold(ui.bad(state));
  if (state === 'failed') return ui.bold(ui.bad(state));
  return ui.warn(state);
}

/** Runs one admin command. Returns the process exit code: 0 ok, 1 failed, 2 misused. */
export async function runAdmin(args: string[], options: AdminDeps): Promise<number> {
  // `--plain` may come anywhere: no colour, ASCII only, the same layout (for scripts and old terminals).
  const plain = args.includes('--plain');
  const argv = args.filter((a) => a !== '--plain');
  const width = options.ui?.width ?? 100;
  const deps: Ctx = { ...options, ui: plain || !options.ui ? plainUi(width) : options.ui };
  const [group, command, ...rest] = argv;
  if (group !== undefined && (command === 'help' || command === '--help' || command === '-h')) {
    const groupHelp = formatGroupHelp(group, deps.ui);
    if (groupHelp !== undefined) {
      deps.out(groupHelp);
      return 0;
    }
  }
  try {
    switch (group) {
      case 'status':
        return await status(deps, argv.slice(1));
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
      case 'test':
        return await selfTests(deps, command, rest);
      case 'recording':
        return await recordings(deps, command, rest);
      case 'campaign':
        return await campaigns(deps, command, rest);
      case 'memory':
        return await memory(deps, command, rest);
      case 'updates':
        return await updates(deps, command, rest);
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        deps.out(formatHelp(deps.ui, deps.host));
        return group === undefined ? 2 : 0;
      default:
        deps.err(
          `${deps.ui.error(`unknown command "${group}"`)}\n\n${formatHelp(deps.ui, deps.host)}`,
        );
        return 2;
    }
  } catch (error) {
    if (error instanceof SettingError || error instanceof ArchiveError) {
      deps.err(deps.ui.error(error.message));
      return 1;
    }
    throw error;
  }
}

type Row = [BadgeKind, string, string];

/**
 * Grades what is known about the configured LLM backend's real context window against what the app
 * assumes (`contextWindowTokens`). `claude` is graded from the built-in table (ai/consts/claude.ts);
 * `openai` has none by design; `local`/`remote` are graded from what the worker last found checking Ollama
 * directly (`localAi.llmContext`), never a live call from here (`vtt-admin` has no path to Ollama).
 */
/**
 * Whether a stored check is still current for `llm`: same kind, and — for `remote`, where the operator
 * names a real model — the same model too, so switching models doesn't read as "still fine" from the
 * previous one's numbers. `local`'s model comes from `OLLAMA_MODEL` (an env var, not this setting, which
 * stays `null` for `local`), so there is nothing meaningful to compare there; kind alone is enough.
 */
function freshContextCheck(
  checked: OllamaContextStatus | null | undefined,
  llm: AiSettings['llm'],
): OllamaContextStatus | undefined {
  if (!checked || checked.kind !== llm.kind) return undefined;
  return llm.kind === 'local' || checked.model === llm.model ? checked : undefined;
}

function aiContextRows(
  settings: AiSettings,
  localAi: LocalAiStatus | null | undefined,
  now: number,
): Row[] {
  const { llm } = settings;
  const row = (badge: BadgeKind, text: string, age?: number, liveAge?: number): Row[] => [
    [
      badge,
      'AI',
      age === undefined
        ? text
        : `${text} (checked ${duration(age / 1000)} ago${liveAge !== undefined ? `; window read ${duration(liveAge / 1000)} ago` : ''})`,
    ],
  ];

  if (llm.kind === 'claude') {
    return llm.model !== null && llm.model in CLAUDE_CONTEXT_WINDOWS
      ? row('ok', `context window: ${CLAUDE_CONTEXT_WINDOWS[llm.model]} tokens (${llm.model})`)
      : row('warn', 'context window: unknown model, using the conservative default');
  }
  if (llm.kind === 'openai') {
    return row('warn', 'context window: unknown (no built-in table for OpenAI models)');
  }

  // local/remote: graded from what the worker last found checking Ollama directly.
  const checked = freshContextCheck(localAi?.llmContext, llm);
  if (!checked) {
    return row('warn', 'context window: not checked yet');
  }
  const age = Math.max(0, now - checked.checkedAt);
  // A remote model that sits idle keeps its last reading for a day (the worker loads it once to read it): say so.
  const liveAge = checked.liveAt !== undefined ? Math.max(0, now - checked.liveAt) : undefined;
  const configured = contextWindowTokens(llm, false);
  if (checked.live !== undefined && checked.live < configured) {
    return row(
      'fail',
      `context window: Ollama is only serving ${checked.live} tokens, but ${configured} is configured`,
      age,
      liveAge,
    );
  }
  if (checked.modelMax !== undefined && checked.modelMax < configured) {
    return row(
      'fail',
      `context window: the model's own maximum is ${checked.modelMax} tokens, but ${configured} is configured`,
      age,
      liveAge,
    );
  }
  if (checked.live !== undefined && checked.live > configured) {
    return row(
      'warn',
      `context window: configured for ${configured} tokens, but Ollama is serving ${checked.live} — vtt-admin status --tune to use them`,
      age,
      liveAge,
    );
  }
  if (
    checked.live === undefined &&
    checked.modelMax !== undefined &&
    checked.modelMax > configured
  ) {
    // A remote server's window is its own OLLAMA_CONTEXT_LENGTH, which only a loaded model reveals; `local`'s is
    // whatever the app asks for, so the model's maximum is a real option there.
    return row(
      'warn',
      llm.kind === 'local'
        ? `context window: configured for ${configured} tokens, but the model supports up to ${checked.modelMax} — vtt-admin status --tune to use more`
        : `context window: configured for ${configured} tokens; the model supports up to ${checked.modelMax}, but the server's own window is not known yet (the worker reads it on its next check): set ai.llm.context to the server's OLLAMA_CONTEXT_LENGTH`,
      age,
      liveAge,
    );
  }
  if (checked.live === undefined && checked.modelMax === undefined) {
    return row('warn', 'context window: unknown (could not reach Ollama to check)', age);
  }
  const spare =
    checked.live !== undefined && checked.modelMax !== undefined && checked.modelMax > checked.live
      ? ` (the server is set to ${checked.live}; the model could do ${checked.modelMax})`
      : '';
  return row('ok', `context window: ${configured} tokens${spare}`, age, liveAge);
}

/**
 * Applies the determined context window for `local`/`remote`: writes `ai.llm.context`, the same path
 * `settings set` uses, only when it would actually change something. `claude`/`openai` have nothing to
 * tune — their window comes from the built-in table or the flat default, never a setting.
 *
 * The live-served number is used for both kinds when known. The model's own trained maximum is only ever
 * applied for `local`: the worker genuinely sends whatever `ai.llm.context` holds as `num_ctx`
 * (`ollamaNumCtx`, tokenBudget.ts), so the app's belief and what Ollama is asked for stay in sync — a
 * VRAM/speed question for the operator, not a truncation risk. For `remote`, nothing the app does can make
 * the remote server actually serve the model's maximum (that is the remote host's own
 * `OLLAMA_CONTEXT_LENGTH`, outside this app's control) — applying it there would trust a number nothing
 * validates, which is the exact silent-truncation risk this feature exists to prevent.
 */
async function tuneAiContext(deps: Ctx, current: InstanceSettings): Promise<void> {
  const { llm } = current.ai;
  if (llm.kind !== 'local' && llm.kind !== 'remote') {
    deps.out(deps.ui.dim('nothing to tune for this backend (claude/openai use a built-in table)'));
    return;
  }
  const fresh = freshContextCheck(deps.localAi?.llmContext, llm);
  const live = fresh?.live;
  const value = live ?? (llm.kind === 'local' ? fresh?.modelMax : undefined);
  if (value === undefined) {
    deps.out(
      deps.ui.warn(
        llm.kind === 'remote'
          ? "could not tune: the remote model's real window is not known yet. The worker loads an idle model and reads it on its next check (within 15 minutes): run this again then, or set ai.llm.context by hand to the server's OLLAMA_CONTEXT_LENGTH"
          : 'could not tune: nothing has been determined yet',
      ),
    );
    return;
  }
  if (llm.context === value) {
    deps.out(deps.ui.dim(`already matches: ai.llm.context is already ${value}`));
    return;
  }
  const next = applySetting(current, 'ai.llm.context', String(value));
  await deps.store.putSettings(next);
  deps.out(
    live !== undefined
      ? deps.ui.done(`tuned: set ai.llm.context = ${value}`)
      : deps.ui.done(
          `tuned: set ai.llm.context = ${value} (the model's own maximum — make sure this machine has enough VRAM/RAM, and watch speed)`,
        ),
  );
}

async function status(deps: Ctx, args: string[] = []): Promise<number> {
  const { ui } = deps;
  if (args.includes('--tune')) {
    await tuneAiContext(deps, await deps.store.getSettings());
  }
  const now = (deps.now ?? Date.now)();
  const machine = deps.machine ? await deps.machine().catch(() => undefined) : undefined;
  const detail = [
    deps.version ? `v${deps.version}` : undefined,
    machine?.hostname,
    machine ? `up ${duration(machine.uptimeSeconds)}` : undefined,
  ]
    .filter(Boolean)
    .join('  ');
  deps.out(ui.title('status', detail));

  // Services: a failure here is what makes `status` exit 1.
  let healthy = true;
  const services: Row[] = [];
  for (const probe of deps.probes ?? []) {
    try {
      services.push(['ok', probe.name, await probe.run()]);
    } catch (error) {
      healthy = false;
      services.push(['fail', probe.name, error instanceof Error ? error.message : String(error)]);
    }
  }
  const { ai } = await deps.store.getSettings();
  const aiRows = aiContextRows(ai, deps.localAi, now);
  if (aiRows.some(([badge]) => badge === 'fail')) healthy = false;
  const sections: [string, Row[]][] = [
    ['Services', services],
    ['AI', aiRows],
    ['This instance', await instanceRows(deps, now)],
    ['This machine', machine ? machineRows(ui, machine) : []],
  ];
  // One table for every section, so the columns line up down the whole screen.
  const all = sections.flatMap(([, rows]) => rows);
  const lines = ui.table(all.map(([kind, name, value]) => [ui.badge(kind), ui.bold(name), value]));
  let at = 0;
  for (const [title, rows] of sections) {
    if (rows.length === 0) continue;
    deps.out('');
    deps.out(ui.section(title));
    lines.slice(at, at + rows.length).forEach(deps.out);
    at += rows.length;
  }
  deps.out('');
  return healthy ? 0 : 1;
}

/** Accounts, sign-ups, campaigns, recordings, the job queue and updates: what the instance is doing. */
async function instanceRows(deps: Ctx, now: number): Promise<Row[]> {
  const { ui } = deps;
  const rows: Row[] = [];
  const pending = (await deps.store.listSignupRequests('pending')).length;
  rows.push(['ok', 'accounts', plural(await deps.store.countUsers(), 'account')]);
  rows.push(
    pending > 0
      ? [
          'warn',
          'sign-ups',
          `${plural(pending, 'request')} waiting  ${ui.hint('vtt-admin signup list')}`,
        ]
      : ['ok', 'sign-ups', 'none waiting'],
  );
  const campaigns = await deps.store.listCampaignSummaries();
  rows.push(['ok', 'campaigns', plural(campaigns.length, 'campaign')]);

  const recent = await deps.records.listRecordings(50);
  const live = recent.filter((r) => r.status === 'recording');
  const names = new Map(campaigns.map((c) => [c.campaign.id, c.campaign.name]));
  rows.push(
    live.length > 0
      ? [
          'ok',
          'recording',
          live
            .map(
              (r) =>
                `${ui.bad(ui.unicode ? '●' : '*')} ${ui.bold('live')} in ${ui.accent(names.get(r.campaignId) ?? r.campaignId)} for ${duration((now - r.startedAt) / 1000)}`,
            )
            .join('; '),
        ]
      : ['off', 'recording', ui.dim('nothing recording right now')],
  );

  const jobs = await deps.jobs.list(['queued', 'running', 'failed']);
  const count = (state: string): number => jobs.filter((j) => j.state === state).length;
  const failed = count('failed');
  const queue = `${count('queued')} queued, ${count('running')} running, ${failed} failed`;
  rows.push(
    failed > 0
      ? ['warn', 'AI jobs', `${queue}  ${ui.hint('vtt-admin jobs list failed')}`]
      : ['ok', 'AI jobs', queue],
  );
  // Which models wrote the last tale, so its quality can be traced to them.
  const last = (await deps.jobs.list(['done']))
    .filter((j) => j.models)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (last?.models) {
    rows.push([
      'off',
      'last tale',
      `${modelsLine(last.models)} ${ui.dim(`(${duration((now - last.updatedAt) / 1000)} ago)`)}`,
    ]);
  }

  if (deps.updatesDir) {
    const feeds = await readFeeds(deps.updatesDir);
    const release = feeds.find((f) => f.channel === 'releases');
    const dev = feeds.find((f) => f.channel === 'dev builds');
    rows.push(
      release || dev
        ? [
            'ok',
            'app updates',
            [
              release && `release ${ui.accent(release.version)}`,
              dev && `dev ${ui.accent(dev.version)}`,
            ]
              .filter(Boolean)
              .join(', '),
          ]
        : ['warn', 'app updates', `none offered  ${ui.hint('vtt-admin updates sync')}`],
    );
  }
  return rows;
}

function machineRows(ui: Ui, m: MachineInfo): Row[] {
  const load = m.cpu.load.map((l) => l.toFixed(2)).join(' ');
  const rows: Row[] = [
    [
      m.cpu.load[1] > m.cpu.cores ? 'warn' : 'ok',
      'cpu',
      `${ui.bar(m.cpu.busy)}  ${plural(m.cpu.cores, 'core')}, load ${load}`,
    ],
  ];
  const memShare = m.memory.totalBytes > 0 ? m.memory.usedBytes / m.memory.totalBytes : 0;
  rows.push([
    memShare >= 0.9 ? 'warn' : 'ok',
    'memory',
    `${ui.bar(memShare)}  ${formatBytes(m.memory.usedBytes)} of ${formatBytes(m.memory.totalBytes)}${m.memory.limited ? ' (container limit)' : ''}`,
  ]);
  for (const disk of m.disks) {
    const used = disk.use.totalBytes > 0 ? 1 - disk.use.freeBytes / disk.use.totalBytes : 0;
    const low = isLow(disk.use);
    rows.push([
      low ? 'warn' : 'ok',
      `disk (${disk.label})`,
      `${ui.bar(used)}  ${formatBytes(disk.use.freeBytes)} free of ${formatBytes(disk.use.totalBytes)}` +
        (low && disk.label.includes('recordings')
          ? `  ${ui.hint('vtt-admin recording purge --older-than 30')}`
          : ''),
    ]);
  }
  rows.push(['ok', 'system', ui.dim(`${m.os}, ${m.cpu.model}`)]);
  return rows;
}

/** The release and dev feeds this server offers (`latest.json` in UPDATES_DIR and its `dev/`). */
async function readFeeds(
  dir: string,
): Promise<
  { channel: 'releases' | 'dev builds'; version: string; date: string; platforms: string[] }[]
> {
  const feeds = [
    ['releases', path.join(dir, 'latest.json')],
    ['dev builds', path.join(dir, 'dev', 'latest.json')],
  ] as const;
  const found = [];
  for (const [channel, file] of feeds) {
    try {
      const latest = JSON.parse(await readFile(file, 'utf8')) as {
        version: string;
        pub_date: string;
        platforms: Record<string, unknown>;
      };
      found.push({
        channel,
        version: latest.version,
        date: latest.pub_date,
        platforms: Object.keys(latest.platforms),
      });
    } catch {
      // this channel has nothing yet
    }
  }
  return found;
}

async function settings(deps: Ctx, command: string | undefined, rest: string[]): Promise<number> {
  const current = await deps.store.getSettings();
  switch (command) {
    case 'show':
      deps.out(deps.ui.title('settings'));
      sectioned(
        deps.ui,
        settingValues(current).map(([key, value]) => [key, paintValue(deps.ui, value)]),
      ).forEach(deps.out);
      deps.out('');
      deps.out(
        `${deps.ui.dim('change one:')} ${deps.ui.command('vtt-admin settings set <key> <value>')}`,
      );
      return 0;
    case 'keys': {
      deps.out(deps.ui.title('settings you can change'));
      const keys = Object.entries({ ...SIMPLE_SETTINGS, ...AI_SETTING_KEYS });
      // The description wraps beside its key, so a long one does not run off the screen.
      const keyWidth = Math.max(...keys.map(([k]) => k.length));
      const room = Math.max(30, deps.ui.width - keyWidth - 4);
      const rows = keys.map(([key, what]): [string, string] => [
        key,
        wrapWords(what, room).join(`\n${' '.repeat(keyWidth + 4)}`),
      ]);
      sectioned(deps.ui, rows).forEach(deps.out);
      return 0;
    }
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
      deps.out(
        deps.ui.done(
          `set ${key} = ${paintValue(deps.ui, settingValues(next).find(([k]) => k === key)?.[1] ?? null)}`,
        ),
      );
      // Saved, but say so loudly if it leaves AI processing unusable (e.g. remote without a URL).
      for (const problem of validateAiSettings(next.ai)) deps.out(deps.ui.caution(problem));
      return 0;
    }
    default:
      misuse(deps, 'settings', command);
      return 2;
  }
}

async function users(deps: Ctx, command: string | undefined, rest: string[]): Promise<number> {
  switch (command) {
    case 'list': {
      const { ui } = deps;
      const all = await deps.store.listUsers();
      deps.out(ui.title('accounts', plural(all.length, 'account')));
      deps.out('');
      ui.table(
        all.map((u) => [
          u.isAdmin ? ui.bold(ui.accent('admin')) : ui.dim('user'),
          u.email,
          u.displayName,
          u.passwordHash ? 'password' : ui.dim('code or link'),
          ui.dim(stamp(u.createdAt).slice(0, 10)),
        ]),
        { header: ['role', 'email', 'name', 'signs in with', 'joined'] },
      ).forEach(deps.out);
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
        deps.out(deps.ui.done(`${user.email} is already ${grant ? 'an Admin' : 'not an Admin'}`));
        return 0;
      }
      await deps.store.putUser({ ...user, isAdmin: grant });
      deps.out(deps.ui.done(`${user.email} is ${grant ? 'now an Admin' : 'no longer an Admin'}`));
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
        `one-time ${purposeArg} code for ${deps.ui.accent(user.email)} (valid about ${minutes} min, works once):`,
      );
      deps.out(showCode(deps.ui, issued.token));
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
        deps.ui.done(
          `created ${deps.ui.accent(user.email)}${user.isAdmin ? ' (Admin)' : ''}; it has no password.`,
        ),
      );
      deps.out(
        `Hand over a sign-in code with: ${deps.ui.command(`vtt-admin user code ${user.email}`)}`,
      );
      return 0;
    }
    case 'revoke-sessions': {
      const user = await findUser(deps, rest[0]);
      await deps.accounts.revokeAllSessions(user.id);
      deps.out(deps.ui.done(`${user.email} is signed out everywhere`));
      return 0;
    }
    default:
      misuse(deps, 'user', command);
      return 2;
  }
}

const SIGNUP_STATES = ['pending', 'approved', 'rejected'] as const;

async function signupRequests(
  deps: Ctx,
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
      const { ui } = deps;
      deps.out(ui.title(`${state} sign-up requests`, plural(list.length, 'request')));
      deps.out('');
      if (list.length === 0) {
        deps.out(ui.dim(`  no ${state} sign-up requests`));
        return 0;
      }
      ui.table(
        list.map((r) => [
          ui.dim(r.id),
          stamp(r.createdAt),
          r.displayName,
          `<${r.email}>`,
          r.message ? ui.dim(`"${r.message.replace(/\s+/g, ' ')}"`) : '',
        ]),
        { header: ['id', 'asked (UTC)', 'name', 'email', 'message'] },
      ).forEach(deps.out);
      if (state === 'pending') {
        deps.out('');
        deps.out(
          `  ${ui.hint('vtt-admin signup approve <id|email>')}  or  ${ui.command('reject')}`,
        );
      }
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
      deps.out(deps.ui.done(`approved ${deps.ui.accent(request.email)}`));
      deps.out(`sign-in code (valid about ${minutes} min, works once):`);
      deps.out(showCode(deps.ui, token));
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
      deps.out(deps.ui.done(`rejected ${request.email}`));
      return 0;
    }
    default:
      misuse(deps, 'signup', command);
      return 2;
  }
}

const JOB_STATES = ['queued', 'running', 'done', 'failed'] as const;

/** "claude-sonnet-5-5 112k in / 9k out, about $0.31" for a job that used Claude or OpenAI; empty for one that ran locally. */
function cloudUsage(usage: Job['usage']): string {
  if (!usage) return '';
  const k = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  const cost = estimateClaudeCost(usage);
  return `${usage.model} ${k(usage.inputTokens)} in / ${k(usage.outputTokens)} out${
    cost === undefined ? '' : `, about $${cost.toFixed(2)}`
  }`;
}

/** "large-v3-turbo (remote), qwen3:8b (remote)": who heard the audio and who wrote, and a note when a remote one could not be reached. */
function modelsLine(models: Job['models']): string {
  if (!models) return '';
  const writer =
    models.scribe === models.bard
      ? models.scribe
      : `${models.scribe} (notes), ${models.bard} (tale)`;
  const fell = models.fellBack?.length
    ? ` — fell back to local for ${models.fellBack.map((w) => (w === 'llm' ? 'the model' : 'transcription')).join(' and ')}`
    : '';
  return `${models.transcription}, ${writer}${fell}`;
}

const TEST_USAGE =
  'usage: test ai [--local] [--remote] [--cloud] | test voice | test reach | test full [--external]';

/** `vtt-admin test`: prove that the AI, the voice server and (on request) the outside route to this server all work. */
async function selfTests(deps: Ctx, sub: string | undefined, rest: string[]): Promise<number> {
  const { ui } = deps;
  const checks = deps.selfTest ?? {};
  const known = sub === 'ai' || sub === 'voice' || sub === 'reach' || sub === 'full';
  const allowed =
    sub === 'ai' ? ['--local', '--remote', '--cloud'] : sub === 'full' ? ['--external'] : [];
  const unknown = rest.find((a) => !allowed.includes(a));
  if (!known || unknown !== undefined) {
    deps.err(unknown && known ? `unknown option ${unknown}. ${TEST_USAGE}` : TEST_USAGE);
    return 2;
  }
  const flags = {
    local: rest.includes('--local'),
    remote: rest.includes('--remote'),
    cloud: rest.includes('--cloud'),
  };
  const all: TestRow[] = [];
  const show = (heading: string, rows: TestRow[]): void => {
    deps.out('');
    deps.out(`  ${ui.dim(heading)}`);
    for (const line of formatTestRows(rows, (kind) => ui.badge(kind))) deps.out(`  ${line}`);
    all.push(...rows);
  };

  deps.out(ui.title(`test ${sub}`, deps.version ? `v${deps.version}` : undefined));
  if (sub === 'ai' || sub === 'full') {
    show(
      'AI: can the worker reach Whisper and the summary model?',
      checks.ai
        ? await checks.ai(flags)
        : [
            {
              badge: 'off',
              name: 'AI',
              detail:
                'tested inside the worker, not here: run vtt-admin test ai (on its own) to try Whisper and the summary model',
            },
          ],
    );
  }
  if (sub === 'voice' || sub === 'full') {
    show(
      'Voice: is LiveKit up, and can it record?',
      checks.voice
        ? await checks.voice()
        : [{ badge: 'off', name: 'Voice', detail: 'not available in this process' }],
    );
  }
  if (sub === 'reach' || (sub === 'full' && rest.includes('--external'))) {
    const targets = reachTargets(checks.publicUrl, checks.voiceAddress, checks.voiceTcpPort);
    if (!targets || !checks.reach) {
      show('From outside: can people on the internet reach this server?', [
        {
          badge: 'warn',
          name: 'Reach from outside',
          detail:
            'this server has no public address set (PUBLIC_URL), so there is nothing to check from outside. Set it with vtt-admin config set SITE_ADDRESS <host>.',
        },
      ]);
    } else {
      deps.out('');
      const hosts = [...new Set([targets.web.host, targets.voice.host])].join(' and ');
      deps.out(
        `  ${ui.dim(`Asking check-host.net, a free public service, to connect to ${hosts} from several countries. It is told ${hosts.includes(' and ') ? 'these addresses' : 'this address'} and nothing else.`)}`,
      );
      show(
        'From outside: can people on the internet reach this server?',
        await checks.reach(targets),
      );
    }
  } else if (sub === 'full') {
    show('From outside', [
      {
        badge: 'off',
        name: 'Reach from outside',
        detail:
          'not asked: it uses check-host.net, a free third-party service. Add --external to include it, or run vtt-admin test reach.',
      },
    ]);
  }
  deps.out('');
  deps.out(`  ${testVerdict(all)}`);
  return testExitCode(all);
}

async function jobs(deps: Ctx, command: string | undefined, rest: string[]): Promise<number> {
  const now = deps.now ?? Date.now;
  switch (command) {
    case 'list': {
      const state = rest[0];
      if (state !== undefined && !(JOB_STATES as readonly string[]).includes(state)) {
        throw new SettingError(`state must be one of ${JOB_STATES.join(', ')}`);
      }
      const list = await deps.jobs.list(state ? [state as (typeof JOB_STATES)[number]] : undefined);
      const { ui } = deps;
      deps.out(ui.title(`${state ?? 'all'} jobs`, plural(list.length, 'job')));
      deps.out('');
      if (list.length === 0) {
        deps.out(ui.dim('  no jobs'));
        return 0;
      }
      // A queued job may be held back by an earlier session of its table (see the order rule in the queue).
      const holders = new Map<string, string>();
      for (const j of list)
        if (j.state === 'queued') {
          const by = await deps.jobs.blockedBy(j.id);
          if (by)
            holders.set(
              j.id,
              `waits for an earlier session's job ${by.id.slice(0, 8)} (${by.state})`,
            );
        }
      ui.table(
        list.map((j) => [
          ui.dim(j.id),
          paintState(ui, j.state),
          j.kind,
          `${j.attempts}/${j.maxAttempts}`,
          cloudUsage(j.usage),
          modelsLine(j.models),
          holders.has(j.id)
            ? ui.dim(holders.get(j.id) as string)
            : j.lastError
              ? ui.bad(j.lastError.slice(0, 80))
              : j.released
                ? ui.dim('released from the order rule')
                : '',
        ]),
        { header: ['id', 'state', 'kind', 'tries', 'cloud AI', 'models', 'last error / waiting'] },
      ).forEach(deps.out);
      if (list.some((j) => j.state === 'failed')) {
        deps.out('');
        deps.out(`  ${ui.hint('vtt-admin jobs retry <job-id>')}`);
        deps.out(
          `  ${ui.hint("vtt-admin jobs release <job-id>   (let the table's later sessions go ahead without it)")}`,
        );
      }
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
      deps.out(deps.ui.done(`job ${job.id} is queued again with a fresh set of attempts`));
      return 0;
    }
    case 'release': {
      const id = rest[0];
      if (!id) {
        deps.err('usage: jobs release <job-id>');
        return 2;
      }
      const job = await deps.jobs.release(id);
      if (!job) throw new SettingError('no failed job with that id');
      deps.out(
        deps.ui.done(
          `job ${job.id} no longer holds back the later sessions of its table. They will be processed without what this one would have added to the campaign memory; \`jobs retry\` puts it back in the queue`,
        ),
      );
      return 0;
    }
    default:
      misuse(deps, 'jobs', command);
      return 2;
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function updates(deps: Ctx, command: string | undefined, rest: string[]): Promise<number> {
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
          deps.ui.error(
            'UPDATES_DIR is not set; set it to the folder the backend serves at /updates',
          ),
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
          deps.ui.done(
            `published ${deps.ui.accent(version)} (${result.channel === 'dev' ? 'dev build: only players who opted in to dev builds are offered it' : 'release: every player is offered it'}) for ${result.platforms.join(', ')} to ${dir}`,
          ),
        );
        return 0;
      } catch (error) {
        deps.err(deps.ui.error(error instanceof Error ? error.message : String(error)));
        return 1;
      }
    }
    case 'sync': {
      if (!deps.syncUpdates) {
        deps.err(
          deps.ui.error(
            'update sync is off; set UPDATES_SOURCE=github (or mirror) and UPDATES_DIR',
          ),
        );
        return 1;
      }
      try {
        const r = await deps.syncUpdates();
        if (!r) {
          deps.err(
            deps.ui.error(
              'update sync is off; set UPDATES_SOURCE=github (or mirror) and UPDATES_DIR',
            ),
          );
          return 1;
        }
        const { ui } = deps;
        deps.out(
          ui.done(
            `offering ${r.release ? ui.accent(r.release) : 'no release'}${r.dev ? `, dev build ${ui.accent(r.dev)}` : ''}`,
          ),
        );
        if (r.downloaded.length) deps.out(`  downloaded: ${r.downloaded.join(', ')}`);
        if (r.removed.length) deps.out(`  removed old versions: ${ui.dim(r.removed.join(', '))}`);
        for (const s of r.skipped) deps.out(ui.caution(`skipped ${s}`));
        return 0;
      } catch (error) {
        deps.err(deps.ui.error(error instanceof Error ? error.message : String(error)));
        return 1;
      }
    }
    case 'status': {
      if (!dir) {
        deps.err(deps.ui.error('UPDATES_DIR is not set'));
        return 1;
      }
      const { ui } = deps;
      deps.out(ui.title('app updates'));
      deps.out('');
      const rows: [string, string][] = [
        ['source', ui.accent(deps.updatesSource ?? 'manual (vtt-admin updates publish)')],
      ];
      if (deps.updatesSource === 'mirror') {
        const usage = await mirrorUsage(dir);
        rows.push([
          'mirror holds',
          `${usage.versions.join(', ') || 'nothing yet'} (${(usage.bytes / 1_048_576).toFixed(0)} MB)`,
        ]);
      }
      const feeds = await readFeeds(dir);
      for (const feed of feeds) {
        rows.push([
          feed.channel,
          `offering ${ui.bold(ui.accent(feed.version))} ${ui.dim(`(${stamp(Date.parse(feed.date))} UTC)`)}`,
        ]);
        rows.push(['', ui.dim(feed.platforms.join(', '))]);
      }
      ui.pairs(rows).forEach(deps.out);
      if (feeds.length === 0) deps.out(ui.caution('no update published'));
      return 0;
    }
    default:
      misuse(deps, 'updates', command);
      return 2;
  }
}

async function recordings(deps: Ctx, command: string | undefined, rest: string[]): Promise<number> {
  switch (command) {
    case 'list': {
      const { ui } = deps;
      const list = await deps.records.listRecordings(20);
      const names = new Map(
        (await deps.store.listCampaignSummaries()).map((c) => [c.campaign.id, c.campaign.name]),
      );
      deps.out(ui.title('recordings', `the newest ${list.length}`));
      deps.out('');
      const rows: string[][] = [];
      for (const r of list) {
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
        const length = r.stoppedAt ? duration((r.stoppedAt - r.startedAt) / 1000) : '';
        rows.push([
          ui.dim(r.id),
          paintState(ui, r.status),
          stamp(r.startedAt),
          length,
          names.get(r.campaignId) ?? ui.dim('(deleted)'),
          plural(tracks.length, 'track'),
          audio === 'audio kept' ? ui.good(audio) : ui.dim(audio),
        ]);
      }
      if (list.length === 0) deps.out(ui.dim('  no recordings'));
      else
        ui.table(rows, {
          header: ['id', 'status', 'started (UTC)', 'length', 'campaign', 'tracks', 'audio'],
        }).forEach(deps.out);
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
        deps.ui.done(
          `queued ${job.id}: will redo the ${transcripts ? 'transcripts and ' : ''}summaries from the kept audio`,
        ),
      );
      return 0;
    }
    case 'delete': {
      const [id] = rest;
      if (!id) {
        deps.err('usage: recording delete <recording-id>');
        return 2;
      }
      const recording = await deps.records.getRecording(id);
      if (!recording) throw new SettingError('no recording with that id');
      if (recording.status === 'recording' || recording.status === 'processing') {
        throw new SettingError('that recording is still in progress or being processed');
      }
      const job = await deps.jobs.enqueue(
        { kind: DELETE_RECORDING_JOB, recordingId: id },
        (deps.now ?? Date.now)(),
      );
      deps.out(
        deps.ui.done(
          `queued ${job.id}: the worker will delete the audio files, then the recording, its transcript and summaries`,
        ),
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
          deps.ui.done(
            `queued ${due.length} purge(s) of raw audio older than ${days} day(s); the worker deletes the files`,
          ),
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
        deps.ui.done(
          `queued ${job.id}: the worker will delete the raw audio and keep the transcript and summaries`,
        ),
      );
      return 0;
    }
    default:
      misuse(deps, 'recording', command);
      return 2;
  }
}

async function memory(deps: Ctx, command: string | undefined, rest: string[]): Promise<number> {
  const { ui } = deps;
  const campaignId = rest[0];
  switch (command) {
    case 'show': {
      if (!campaignId) {
        deps.err('usage: memory show <campaign-id>');
        return 2;
      }
      const found = (await deps.store.listCampaignSummaries()).find(
        (c) => c.campaign.id === campaignId,
      );
      if (!found) throw new SettingError('no campaign with that id (see: campaign list)');
      const entries = await deps.records.listMemory(campaignId);
      deps.out(
        ui.title(`memory of ${found.campaign.name}`, plural(entries.length, 'entry', 'entries')),
      );
      deps.out('');
      if (entries.length === 0) {
        deps.out(ui.dim('  nothing yet: it fills as sessions are processed (ai.memory.enabled)'));
        return 0;
      }
      ui.table(
        entries.map((e) => [
          ui.bold(e.name),
          MEMORY_KIND_LABELS[e.kind],
          e.aliases.join(', ') || ui.dim('none'),
          e.gist,
          String(e.timesSeen),
        ]),
        { header: ['name', 'kind', 'also', 'gist', 'sessions'] },
      ).forEach(deps.out);
      return 0;
    }
    case 'forget': {
      const name = rest.slice(1).join(' ').trim();
      if (!campaignId || !name) {
        deps.err('usage: memory forget <campaign-id> <name>');
        return 2;
      }
      const gone = await deps.records.forgetMemory(campaignId, name);
      if (gone === 0)
        throw new SettingError(
          `nothing called "${name}" in that campaign's memory (see: memory show)`,
        );
      deps.out(
        ui.good(
          `forgot ${plural(gone, 'entry', 'entries')}. A later session may learn it again if the notes mention it.`,
        ),
      );
      return 0;
    }
    default:
      misuse(deps, 'memory', command);
      return 2;
  }
}

async function campaigns(deps: Ctx, command: string | undefined, rest: string[]): Promise<number> {
  switch (command) {
    case 'list': {
      const { ui } = deps;
      const all = await deps.store.listCampaignSummaries();
      deps.out(ui.title('campaigns', plural(all.length, 'campaign')));
      deps.out('');
      if (all.length === 0) {
        deps.out(ui.dim('  no campaigns'));
        return 0;
      }
      const rows: string[][] = [];
      for (const { campaign, members, dmName } of all) {
        const sessions = (await deps.records.listRecordingsForCampaign(campaign.id)).length;
        rows.push([
          ui.dim(campaign.id),
          ui.bold(campaign.name),
          dmName ?? ui.dim('none'),
          String(members),
          String(sessions),
        ]);
      }
      ui.table(rows, { header: ['id', 'name', 'DM', 'members', 'recordings'] }).forEach(deps.out);
      return 0;
    }
    case 'delete': {
      const [id, ...flags] = rest;
      if (!id) {
        deps.err('usage: campaign delete <campaign-id> [--yes]');
        return 2;
      }
      const unknown = flags.filter((f) => f !== '--yes');
      if (unknown.length > 0) throw new SettingError(`unknown option ${unknown[0]}`);
      const found = (await deps.store.listCampaignSummaries()).find((c) => c.campaign.id === id);
      if (!found) throw new SettingError('no campaign with that id (see: campaign list)');
      const recordings = await deps.records.listRecordingsForCampaign(id);
      const live = recordings.filter((r) => r.status === 'recording' || r.status === 'processing');
      if (live.length > 0) {
        throw new SettingError(
          `${live.length} recording(s) of that campaign are still in progress or being processed; wait for them (see: jobs list)`,
        );
      }
      deps.out(
        `"${deps.ui.bold(found.campaign.name)}": ${found.members} member(s), ${recordings.length} recording(s) with their audio, transcripts and summaries, plus its chat, handouts, loot and schedule.`,
      );
      if (!flags.includes('--yes')) {
        deps.out(deps.ui.caution('This cannot be undone. Run it again with --yes to delete it.'));
        return 2;
      }
      const now = (deps.now ?? Date.now)();
      for (const r of recordings) {
        await deps.jobs.enqueue({ kind: DELETE_RECORDING_JOB, recordingId: r.id }, now);
      }
      if (recordings.length > 0) {
        deps.out(
          `queued ${recordings.length} recording(s) for the worker, waiting for it to remove them...`,
        );
        const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        const limit = (deps.campaignDeleteWaitSeconds ?? 600) * 1000;
        let waited = 0;
        while ((await deps.records.listRecordingsForCampaign(id)).length > 0) {
          if (waited >= limit) {
            deps.err(
              'the worker has not removed every recording yet (is it running? see: jobs list). Nothing else was deleted; run the same command again to carry on.',
            );
            return 1;
          }
          await sleep(2000);
          waited += 2000;
        }
      }
      await deps.store.deleteCampaign(id);
      deps.out(deps.ui.done(`deleted the campaign "${found.campaign.name}".`));
      if (deps.sweepMedia) {
        const files = await deps.sweepMedia();
        deps.out(deps.ui.done(`removed ${files} handout file(s) no longer used by anything.`));
      } else {
        deps.out(
          'MEDIA_DIR is not set here, so its handout files were left; the backend removes unused ones daily.',
        );
      }
      deps.out(
        'People connected to it keep their seat until their app reconnects; restart the backend to drop them now.',
      );
      return 0;
    }
    case 'export': {
      const [id, file, ...flags] = rest;
      if (!id || !file) {
        deps.err('usage: campaign export <campaign-id> <file> [--accept-loss]');
        return 2;
      }
      const unknown = flags.filter((f) => f !== '--accept-loss');
      if (unknown.length > 0) throw new SettingError(`unknown option ${unknown[0]}`);
      if (!deps.archive)
        throw new SettingError('export needs the database; run it through vtt-admin');
      const found = (await deps.store.listCampaignSummaries()).find((c) => c.campaign.id === id);
      if (!found) throw new SettingError('no campaign with that id (see: campaign list)');
      const unfinished = await deps.archive.unprocessed(id);
      if (unfinished.length > 0) {
        deps.out(
          `${unfinished.length} session(s) of "${found.campaign.name}" have no transcript or summary yet, so the file would hold nothing of them (the audio is not exported):`,
        );
        for (const r of unfinished) {
          deps.out(
            `  ${deps.ui.dim(r.id)}  ${stamp(r.startedAt)}  ${paintState(deps.ui, r.status)}`,
          );
        }
        if (!flags.includes('--accept-loss')) {
          deps.out(
            'Wait for them to finish (see: jobs list), or run it again with --accept-loss to export without them.',
          );
          return 2;
        }
        deps.out(deps.ui.caution('going ahead without them (--accept-loss).'));
      }
      // One extension, so the files are recognisable: `.vttcampaign` is added when it is missing.
      const target = file.endsWith('.vttcampaign') ? file : `${file}.vttcampaign`;
      const { bytes, missingMedia } = await deps.archive.export(id, target);
      deps.out(
        deps.ui.done(
          `wrote "${found.campaign.name}" to ${deps.ui.accent(target)} (${formatBytes(bytes)}).`,
        ),
      );
      if (missingMedia.length > 0) {
        deps.err(
          deps.ui.caution(
            `${missingMedia.length} handout file(s) were missing on disk and are not in it.`,
          ),
        );
      }
      deps.out(
        deps.ui.caution(
          'It holds the whole campaign, whispers included: keep it as private as the database.',
        ),
      );
      return 0;
    }
    case 'import': {
      const [file, ...flags] = rest;
      if (!file) {
        deps.err('usage: campaign import <file> [--as-new]');
        return 2;
      }
      const unknown = flags.filter((f) => f !== '--as-new');
      if (unknown.length > 0) throw new SettingError(`unknown option ${unknown[0]}`);
      if (!deps.archive)
        throw new SettingError('import needs the database; run it through vtt-admin');
      const result = await deps.archive.import(file, { asNew: flags.includes('--as-new') });
      deps.out(
        deps.ui.done(
          `imported "${result.name}" (${result.campaignId}): ${result.recordings} recording(s), ${result.files} handout file(s).`,
        ),
      );
      deps.out(`${result.matched} member(s) matched an account here by email.`);
      if (result.created.length > 0) {
        deps.out(
          `${result.created.length} had no account here, so one was made with no password (they sign in by emailed link or single sign-on, or you can give them a code: user ...):`,
        );
        deps.ui.table(result.created.map((p) => [p.email, p.displayName])).forEach(deps.out);
      }
      deps.out(
        'The audio of its sessions is not in the file: restore it from the server backup if you need it.',
      );
      return 0;
    }
    default:
      misuse(deps, 'campaign', command);
      return 2;
  }
}

async function storage(deps: Ctx): Promise<number> {
  const { ui } = deps;
  deps.out(ui.title('storage'));
  deps.out('');
  const rows: [string, string][] = [];
  let ok = true;
  if (deps.recordingsDir === undefined) {
    rows.push(['recordings', ui.dim('not kept on this server (RECORDINGS_DIR is not set)')]);
  } else {
    const use = await measureDisk(deps.recordingsDir, { walk: true });
    if (!use) {
      deps.err(ui.error(`cannot read ${deps.recordingsDir}`));
      return 1;
    }
    rows.push([
      'recordings',
      `${ui.bold(formatBytes(use.dirBytes ?? 0))}  ${ui.dim(deps.recordingsDir)}`,
    ]);
    rows.push([
      'that disk',
      `${ui.bar(1 - freePercent(use) / 100)}  ${formatBytes(use.freeBytes)} free of ${formatBytes(use.totalBytes)} (${freePercent(use)}%)`,
    ]);
    ok = !isLow(use);
  }
  if (deps.databaseBytes) rows.push(['database', ui.bold(formatBytes(await deps.databaseBytes()))]);
  ui.pairs(rows).forEach(deps.out);
  if (!ok) {
    deps.out('');
    deps.out(ui.caution('that disk is nearly full. Purge raw audio:'));
    deps.out(`  ${ui.hint('vtt-admin recording purge --older-than 30')}`);
  }
  return 0;
}
