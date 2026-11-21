/**
 * What the History screens show of a recorded session, shared by the desktop and phone apps (decided with Andy,
 * 2026-11-21): the tale first, with the chapters and the hero summaries folded under "More detail"; a title the
 * storyteller gave the session at the top of the tale; and one tidy line in place of a list of kinds. Pure text
 * helpers: they read the summaries the records API already returns, so there is no wire change.
 */

/** The title the storyteller put on the first line of the tale (`# The Weeping Anchor`), and the tale without it. */
export function splitTaleTitle(text: string): { title: string | null; body: string } {
  const lines = text.replace(/^\s+/, '').split('\n');
  const first = lines[0] ?? '';
  const m = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(first);
  if (!m) return { title: null, body: text.trim() };
  // A title is a few words; a model that put a whole sentence after the # has written a paragraph, not a title.
  const title = (m[1] as string).replace(/^[*_"“‘']+|[*_"”’']+$/g, '').trim();
  if (title.length < 2 || title.length > 80) return { title: null, body: text.trim() };
  return { title, body: lines.slice(1).join('\n').trim() };
}

export interface Partitioned<T> {
  /** The tale and (for the Game Master) the brief: always shown. */
  main: T[];
  /** The chapter and hero summaries: folded under "More detail". */
  more: T[];
  /** The scribe's notes (Game Master only): folded behind their own button. */
  notes: T[];
}

export function partitionSummaries<T extends { kind: string }>(list: readonly T[]): Partitioned<T> {
  const out: Partitioned<T> = { main: [], more: [], notes: [] };
  for (const s of list) {
    if (s.kind === 'notes') out.notes.push(s);
    else if (s.kind === 'chapter' || s.kind === 'character') out.more.push(s);
    else out.main.push(s);
  }
  return out;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Tale ready · 6 chapters · 4 heroes": what a session holds, from the kinds the viewer may read. */
export function summaryBlurb(kinds: readonly string[]): string {
  const count = (k: string) => kinds.filter((x) => x === k).length;
  const parts: string[] = [];
  if (count('session') > 0) parts.push('Tale ready');
  if (count('chapter') > 0) parts.push(plural(count('chapter'), 'chapter', 'chapters'));
  if (count('character') > 0) parts.push(plural(count('character'), 'hero', 'heroes'));
  return parts.join(' · ');
}

/** The "More detail" button's label: how much is folded away. */
export function moreDetailLabel(more: readonly { kind: string }[]): string {
  const blurb = summaryBlurb(more.map((s) => s.kind));
  return blurb ? `More detail (${blurb})` : 'More detail';
}
