/**
 * What `vtt-admin test` prints: one row per thing checked, in the same ok / warn / fail / off words `vtt-admin status`
 * uses. Shared because the AI checks run in the worker's package and the voice and reach checks in the backend's, and
 * one command shows them all.
 */
export type TestBadge = 'ok' | 'warn' | 'fail' | 'off';

export interface TestRow {
  badge: TestBadge;
  /** What was checked, short: "Whisper (local)". */
  name: string;
  /** What was found, one line: "answered in 1.2 s". */
  detail: string;
}

/** The exit code of a test run: 1 when anything failed, otherwise 0 (a warning is not a failure). */
export const testExitCode = (rows: readonly TestRow[]): 0 | 1 =>
  rows.some((r) => r.badge === 'fail') ? 1 : 0;

/** The line at the bottom: the operator's "is everything good?" answer. */
export function testVerdict(rows: readonly TestRow[]): string {
  const fails = rows.filter((r) => r.badge === 'fail').length;
  const warns = rows.filter((r) => r.badge === 'warn').length;
  if (fails > 0)
    return `${fails} ${fails === 1 ? 'problem' : 'problems'} found${warns ? `, and ${warns} to look at` : ''}.`;
  if (warns > 0) return `Working, with ${warns} ${warns === 1 ? 'thing' : 'things'} to look at.`;
  return 'Everything looks good.';
}

const PLAIN_BADGE: Record<TestBadge, string> = {
  ok: 'ok  ',
  warn: 'WARN',
  fail: 'FAIL',
  off: '--  ',
};

/**
 * The rows as lines of text. `badge` paints the marker (the CLI passes its coloured one); the names are padded so the
 * findings line up, whatever the marker's colour codes.
 */
export function formatTestRows(
  rows: readonly TestRow[],
  badge: (kind: TestBadge) => string = (kind) => PLAIN_BADGE[kind],
): string[] {
  const width = Math.max(0, ...rows.map((r) => r.name.length));
  return rows.map((r) => `${badge(r.badge)} ${r.name.padEnd(width)}  ${r.detail}`);
}
