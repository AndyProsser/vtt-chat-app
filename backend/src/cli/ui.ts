import { styleText } from 'node:util';

/**
 * How `vtt-admin` draws its output: colour and a few box-drawing characters on a terminal, plain ASCII
 * otherwise.
 *
 * Why built in rather than a library: Node's `util.styleText` covers the colours, and the rest (padding,
 * bars, badges) is a page of code. No dependency, and nothing new to update.
 *
 * Rich output is the default on a terminal. Plain output (no colour, ASCII only, the same layout) is used
 * with `--plain` or `VTT_ADMIN_PLAIN=1`, when the output is piped or redirected (so scripts and logs get
 * clean text), and in tests. `NO_COLOR` turns colour off but keeps the graphics; `FORCE_COLOR` turns both
 * on without a terminal. The Compose wrapper sets one or the other from its own output, because inside
 * `docker compose exec` the container cannot tell a pipe from a terminal.
 */

type Style = Parameters<typeof styleText>[0];

export type BadgeKind = 'ok' | 'warn' | 'fail' | 'off';

export interface Ui {
  /** Colour escapes are written. */
  readonly color: boolean;
  /** Box-drawing characters and symbols are used (false: ASCII only). */
  readonly unicode: boolean;
  /** Columns to fit (help, wrapped text). */
  readonly width: number;
  bold(text: string): string;
  dim(text: string): string;
  /** Names, ids and values the eye should land on. */
  accent(text: string): string;
  good(text: string): string;
  warn(text: string): string;
  bad(text: string): string;
  /** A command to type next. */
  command(text: string): string;
  /** The top line of a screen: `VTT Chat · status`, with a rule. */
  title(text: string, detail?: string): string;
  /** A section heading within a screen. */
  section(text: string): string;
  /** A fixed-width status marker: `✔ ok`, `▲ warn`, `✖ FAIL`, `○ off` (plain: `ok`, `WARN`, `FAIL`, `--`). */
  badge(kind: BadgeKind): string;
  /** A usage bar for `used` out of 1, coloured green, amber at 75 %, red at 90 %. */
  bar(used: number, cells?: number): string;
  /** A finished action: `✔ text` (plain: the text alone). */
  done(text: string): string;
  /** Something to look at: `▲ text` (plain: `warning: text`). */
  caution(text: string): string;
  /** A failure: `✖ error: text` (plain: `error: text`). */
  error(text: string): string;
  /** "see: vtt-admin jobs list": a hint pointing at the next command. */
  hint(command: string): string;
  /** Rows aligned in columns (colour-aware); the last column is not padded. */
  table(rows: string[][], options?: { header?: string[]; indent?: number }): string[];
  /** `key   value` lines with the keys aligned. */
  pairs(rows: [string, string][], options?: { indent?: number }): string[];
}

export interface UiOptions {
  plain?: boolean;
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  width?: number;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** The width a string takes on screen, without its colour escapes. */
export const visibleLength = (text: string): number => text.replace(ANSI, '').length;

const padVisible = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - visibleLength(text)));

const flagOn = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== '0' && value !== 'false';

/** Decides rich or plain from the flag, the terminal and the environment. */
export function createUi(options: UiOptions = {}): Ui {
  const env = options.env ?? {};
  const forced = flagOn(env.FORCE_COLOR);
  const plain = options.plain === true || flagOn(env.VTT_ADMIN_PLAIN);
  const rich = !plain && (options.isTTY === true || forced);
  const color = rich && !flagOn(env.NO_COLOR);
  return makeUi({ color, unicode: rich, width: options.width ?? 100 });
}

/** Plain output: what tests and pipes get. */
export const plainUi = (width = 100): Ui => makeUi({ color: false, unicode: false, width });

function makeUi(mode: { color: boolean; unicode: boolean; width: number }): Ui {
  const { color, unicode, width } = mode;
  const paint =
    (style: Style) =>
    (text: string): string =>
      color ? styleText(style, text, { validateStream: false }) : text;

  const bold = paint('bold');
  const dim = paint('dim');
  const accent = paint('cyan');
  const good = paint('green');
  const warn = paint('yellow');
  const bad = paint('red');
  const command = paint(['cyan', 'bold']);
  const rule = (n: number): string => (unicode ? '─' : '-').repeat(Math.max(0, n));

  const ui: Ui = {
    color,
    unicode,
    width,
    bold,
    dim,
    accent,
    good,
    warn,
    bad,
    command,
    title(text, detail) {
      const head = `${bold(accent('VTT Chat'))} ${dim(unicode ? '·' : '-')} ${bold(text)}`;
      let line = detail ? `${head}  ${dim(detail)}` : head;
      // Too long for the screen: the detail goes on its own line.
      if (detail && visibleLength(line) > width) line = `${head}\n${dim(detail)}`;
      const longest = Math.max(...line.split('\n').map(visibleLength));
      return `${line}\n${dim(rule(Math.min(width, Math.max(longest, 40))))}`;
    },
    section(text) {
      return unicode ? bold(`▸ ${text}`) : `== ${text} ==`;
    },
    badge(kind) {
      if (!unicode) return { ok: 'ok  ', warn: 'WARN', fail: 'FAIL', off: '--  ' }[kind];
      return {
        ok: good('✔ ok  '),
        warn: warn('▲ warn'),
        fail: bad(bold('✖ FAIL')),
        off: dim('○ off '),
      }[kind];
    },
    bar(used, cells = 20) {
      const share = Math.min(1, Math.max(0, Number.isFinite(used) ? used : 0));
      const filled = Math.round(share * cells);
      const tone = share >= 0.9 ? bad : share >= 0.75 ? warn : good;
      const percent = `${Math.round(share * 100)}%`.padStart(4);
      if (!unicode) return `[${'#'.repeat(filled)}${'.'.repeat(cells - filled)}] ${percent}`;
      return `${tone('█'.repeat(filled))}${dim('░'.repeat(cells - filled))} ${tone(percent)}`;
    },
    done(text) {
      return unicode ? `${good('✔')} ${text}` : text;
    },
    caution(text) {
      return unicode ? `${warn('▲')} ${warn(text)}` : `warning: ${text}`;
    },
    error(text) {
      return unicode ? `${bad(bold('✖ error:'))} ${text}` : `error: ${text}`;
    },
    hint(text) {
      return `${dim(unicode ? '→' : 'see:')} ${command(text)}`;
    },
    table(rows, options = {}) {
      const all = options.header ? [options.header.map((h) => bold(h)), ...rows] : rows;
      const columns = Math.max(0, ...all.map((r) => r.length));
      const widths = Array.from({ length: columns }, (_, c) =>
        Math.max(0, ...all.map((r) => visibleLength(r[c] ?? ''))),
      );
      const pad = ' '.repeat(options.indent ?? 2);
      return all.map(
        (row) =>
          pad +
          row
            .map((cell, c) => (c === row.length - 1 ? cell : padVisible(cell, widths[c] ?? 0)))
            .join('  ')
            .trimEnd(),
      );
    },
    pairs(rows, options = {}) {
      return ui.table(
        rows.map(([k, v]) => [dim(k), v]),
        { indent: options.indent ?? 2 },
      );
    },
  };
  return ui;
}

/** "1 account", "2 accounts". */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** A date and time to the minute, in UTC: `2026-11-20 06:40`. */
export const stamp = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/** "3d 4h", "2h 5m", "40s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
