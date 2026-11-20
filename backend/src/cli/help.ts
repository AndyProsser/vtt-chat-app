import { MAGIC_LINK_TTL_MINUTES, RESET_LINK_TTL_MINUTES } from '../consts/index.js';
import type { Ui } from './ui.js';

/**
 * `vtt-admin help`: every command, grouped, word-wrapped to the terminal.
 *
 * Why a table and a formatter rather than one hand-aligned string: the old string wrapped wherever the
 * terminal cut it (mid-word, back at column 0), and its hand-made continuation lines were only right at
 * one width. The commands also live in one place, so `vtt-admin <group>` can print just that group.
 *
 * The width comes from `COLUMNS` (the Compose wrapper passes it in, because `docker compose exec -T` has
 * no terminal to ask) or the terminal itself, and falls back to 100.
 */

export interface HelpCommand {
  usage: string;
  summary: string;
}

export interface HelpSection {
  /** The first word of its commands (`user`, `campaign`, ...), for `vtt-admin <group>`; none for mixed sections. */
  group?: string;
  title: string;
  commands: HelpCommand[];
}

/** Which wrapper ran the CLI: it decides the "this machine" section (`VTT_ADMIN_HOST`). */
export type AdminHost = 'compose' | 'native' | undefined;

export const SERVER_SECTIONS: HelpSection[] = [
  {
    title: 'Health and disk',
    commands: [
      {
        usage: 'status',
        summary:
          'health of each service; what the instance is doing (sign-ups, a live recording, AI jobs, ' +
          'app updates); CPU, memory and disk use',
      },
      { usage: 'storage', summary: 'disk use: recordings, free space, database size' },
    ],
  },
  {
    group: 'settings',
    title: 'Settings (stored in the database)',
    commands: [
      { usage: 'settings show', summary: 'every setting and its value' },
      { usage: 'settings keys', summary: 'every setting you can change, and what it accepts' },
      { usage: 'settings set <key> <value>', summary: 'change one setting' },
    ],
  },
  {
    group: 'user',
    title: 'Accounts',
    commands: [
      { usage: 'user list', summary: 'all accounts' },
      {
        usage: 'user create <email> --name <name> --accept-consent [--admin]',
        summary: 'make an account (no password; the first one is the Admin)',
      },
      {
        usage: 'user admin <email> grant|revoke',
        summary: 'give or take away Admin (the last Admin cannot be removed)',
      },
      {
        usage: 'user code <email> [signin|reset]',
        summary:
          `issue a one-time code to hand over on a side channel (valid ${MAGIC_LINK_TTL_MINUTES} min, ` +
          `${RESET_LINK_TTL_MINUTES} for reset). A signin code also connects the desktop app ` +
          '(the code box on its Connect screen) when no browser is at hand',
      },
      { usage: 'user revoke-sessions <email>', summary: 'sign that account out on every device' },
    ],
  },
  {
    group: 'signup',
    title: 'Sign-up requests',
    commands: [
      {
        usage: 'signup list [pending|approved|rejected]',
        summary: 'sign-up requests from visitors (default: pending)',
      },
      {
        usage: 'signup approve <id|email>',
        summary: 'make the account and print a one-time code to hand over on a side channel',
      },
      { usage: 'signup reject <id|email>', summary: 'turn a request down (nothing is sent)' },
    ],
  },
  {
    group: 'campaign',
    title: 'Campaigns',
    commands: [
      { usage: 'campaign list', summary: 'every campaign: id, name, DM, players, recordings' },
      {
        usage: 'campaign export <id> <file> [--accept-loss]',
        summary:
          'write one campaign to a .vttcampaign file (a zip): text, handout files, transcripts and ' +
          'summaries, but not the audio (the server backup has that). Refuses while a session has no ' +
          'transcript yet, unless --accept-loss says to go ahead without it',
      },
      {
        usage: 'campaign import <file> [--as-new]',
        summary:
          'restore a campaign from such a file; --as-new makes a copy with fresh ids when the campaign ' +
          'is still here',
      },
      {
        usage: 'campaign delete <id> [--yes]',
        summary:
          'remove a campaign for good: its sessions and audio (via the worker), chat, handouts and ' +
          'their files. Without --yes it only shows what would go',
      },
    ],
  },
  {
    group: 'memory',
    title: 'Campaign memory',
    commands: [
      {
        usage: 'memory show <campaign-id>',
        summary:
          'what the campaign has already met (people, creatures, places, groups, quests, items) as kept ' +
          'from its sessions, for the tale and the Game Master brief to refer back to',
      },
      {
        usage: 'memory forget <campaign-id> <name>',
        summary: 'remove one wrong entry by its name or alias (a later session may learn it again)',
      },
    ],
  },
  {
    group: 'recording',
    title: 'Recordings',
    commands: [
      { usage: 'recording list', summary: 'recent recordings and their status' },
      {
        usage: 'recording reprocess <id> [--retranscribe]',
        summary: 'redo the summaries (and with the flag, the transcripts) from the kept audio',
      },
      {
        usage: 'recording purge <id>',
        summary: 'delete the raw audio of one processed recording (the text stays)',
      },
      {
        usage: 'recording purge --older-than <days>',
        summary: 'the same for every processed recording older than that',
      },
      {
        usage: 'recording delete <id>',
        summary: 'remove a whole session: its audio, transcript and summaries (the worker does it)',
      },
    ],
  },
  {
    group: 'jobs',
    title: 'Records pipeline jobs',
    commands: [
      {
        usage: 'jobs list [queued|running|done|failed]',
        summary: 'records-pipeline jobs, newest last',
      },
      { usage: 'jobs retry <job-id>', summary: 'put a failed job back in the queue' },
    ],
  },
  {
    group: 'updates',
    title: 'Desktop app updates',
    commands: [
      {
        usage: 'updates status',
        summary: 'the update source, what players are offered, and what the mirror holds',
      },
      {
        usage: 'updates sync',
        summary: "fetch the newest release of this server's line from GitHub now (UPDATES_SOURCE)",
      },
      {
        usage: 'updates publish <dir> --version <v> --base-url <url> [--notes <text>]',
        summary: "publish a signed client release (the bundler's output) to UPDATES_DIR",
      },
    ],
  },
];

/** The Compose wrapper's own commands (`infra/compose/vtt-admin`); they run docker compose, not this CLI. */
const COMPOSE_SECTION: HelpSection = {
  title: 'This machine (Docker Compose)',
  commands: [
    { usage: 'ps', summary: 'what is running' },
    {
      usage: 'logs [service]',
      summary:
        "follow a service's log (default: backend; others: caddy, livekit, worker, egress, postgres)",
    },
    { usage: 'restart [service]', summary: 'restart everything, or one service' },
    {
      usage: 'backup [--audio]',
      summary: 'a backup folder of the database, uploads and settings (see the operator guide)',
    },
    { usage: 'restore <folder> --yes', summary: 'put a backup back (replaces what is here)' },
    {
      usage: 'update [--version x.y.z]',
      summary: 'update this server to the newest release of its line (your data stays)',
    },
    { usage: 'config show', summary: 'the settings file (.env), secrets hidden' },
    { usage: 'config set KEY VALUE', summary: 'change one value in .env and apply it' },
    {
      usage: 'voice-address <ip|name|auto>',
      summary:
        "the address players' voice connects to (use when the web name is behind Cloudflare)",
    },
  ],
};

/** A native install has no wrapper commands; these are the system tools that do the same jobs. */
const NATIVE_SECTION: HelpSection = {
  title: 'This machine (native install: run these as root, not through vtt-admin)',
  commands: [
    {
      usage: 'systemctl status vtt-backend',
      summary:
        'is it running (the services: vtt-backend, vtt-livekit, vtt-worker, vtt-whisper, vtt-ollama)',
    },
    { usage: 'journalctl -u vtt-backend -f', summary: "follow a service's log" },
    { usage: 'systemctl restart vtt-backend', summary: 'restart one service' },
    {
      usage: 'infra/backup-native.sh',
      summary:
        'a backup folder of the database, uploads and settings, run from your copy of the repo (see the operator guide)',
    },
    {
      usage: 'infra/restore-native.sh <folder> --yes',
      summary: 'put a backup back (replaces what is here)',
    },
  ],
};

const HEADER = 'system operations (gameplay is managed inside the app)';

const MIN_WIDTH = 60;
const MAX_WIDTH = 120;
const DEFAULT_WIDTH = 100;
const INDENT = 2;
/** The usage column; a longer usage takes its own line and the summary starts on the next. */
const USAGE_COLUMN = 36;
const GAP = 2;

/** The width to wrap to: a usable `COLUMNS`, else the terminal's, else 100; kept between 60 and 120. */
export function helpWidth(columns: string | undefined, terminal: number | undefined): number {
  const asked = Number(columns);
  const width = Number.isInteger(asked) && asked > 0 ? asked : (terminal ?? DEFAULT_WIDTH);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

/** Splits text into lines of at most `width`, breaking only between words (a longer word stands alone). */
export function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  // A bracketed option (`[--notes <text>]`) counts as one word, so it never splits across lines.
  for (const word of text.match(/\[[^\]]*\]|\S+/g) ?? []) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function commandLines(command: HelpCommand, ui: Ui): string[] {
  const { width } = ui;
  const pad = ' '.repeat(INDENT);
  const summaryIndent = INDENT + USAGE_COLUMN + GAP;
  // Narrow terminals: the summary goes under the usage instead of beside it.
  const besideFits = width - summaryIndent >= 40;
  const indent = besideFits ? summaryIndent : INDENT * 3;
  const summary = wrapWords(command.summary, width - indent);
  const hang = ' '.repeat(indent);
  if (besideFits && command.usage.length <= USAGE_COLUMN) {
    const [first = '', ...more] = summary;
    const gap = ' '.repeat(USAGE_COLUMN + GAP - command.usage.length);
    return [pad + ui.command(command.usage) + gap + first, ...more.map((l) => hang + l)];
  }
  // A usage too long for the line wraps between words, its later lines indented a little further.
  const usage = wrapWords(command.usage, width - INDENT - 2).map(
    (l, i) => (i === 0 ? pad : pad + '  ') + ui.command(l),
  );
  return [...usage, ...summary.map((l) => hang + l)];
}

function sectionLines(section: HelpSection, ui: Ui): string[] {
  return [ui.section(section.title), ...section.commands.flatMap((c) => commandLines(c, ui))];
}

/** Every section this CLI is run with: the server's, then the machine's for the wrapper that ran it. */
export function helpSections(host: AdminHost): HelpSection[] {
  if (host === 'compose') return [...SERVER_SECTIONS, COMPOSE_SECTION];
  if (host === 'native') return [...SERVER_SECTIONS, NATIVE_SECTION];
  return SERVER_SECTIONS;
}

/** The full help. */
export function formatHelp(ui: Ui, host: AdminHost): string {
  const body = helpSections(host).map((s) => sectionLines(s, ui).join('\n'));
  // Two short lines, so they never need wrapping (the narrowest width is 60).
  const footer = [
    `${ui.command('vtt-admin <group>')} shows one group, e.g. ${ui.command('vtt-admin campaign')}`,
    `${ui.command('--plain')} anywhere: no colour or graphics`,
  ].join('\n');
  return [ui.title('vtt-admin', HEADER), ...body, footer].join('\n\n');
}

/** One group's commands, for `vtt-admin <group>` without a command; undefined for an unknown group. */
export function formatGroupHelp(group: string, ui: Ui): string | undefined {
  const section = SERVER_SECTIONS.find((s) => s.group === group);
  return section ? sectionLines(section, ui).join('\n') : undefined;
}

/** Reads `VTT_ADMIN_HOST`; anything else (or unset) shows no machine section. */
export function adminHost(value: string | undefined): AdminHost {
  return value === 'compose' || value === 'native' ? value : undefined;
}
