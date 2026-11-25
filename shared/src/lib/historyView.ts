/**
 * What the History screens show of a recorded session, shared by the desktop and phone apps: the session as tabs (The
 * Tale, The Heroes, The Story, The Notes; Andy, 2026-11-23); a title the storyteller gave the session at the top of the
 * tale; and one tidy line in place of a list of kinds. Pure text
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

export type HistoryTabId = 'tale' | 'heroes' | 'story' | 'notes';

export interface HistoryTab<T> {
  id: HistoryTabId;
  label: string;
  items: T[];
}

const TAB_LABELS: Record<HistoryTabId, string> = {
  tale: 'The Tale',
  heroes: 'The Heroes',
  story: 'The Story',
  notes: 'The Notes',
};

/**
 * A session's summaries as tabs (Andy, 2026-11-23, built 2026-11-25): The Tale, The Heroes (one summary for each
 * hero), The Story (the chapters) and The Notes (the Game Master's brief, then the scribe's notes). One section is
 * shown at a time. A tab with nothing in it is left out, which is how a player never sees The Notes: the server only
 * sends them what they may read. A kind this build does not know stays with the tale rather than vanishing.
 */
export function historyTabs<T extends { kind: string }>(list: readonly T[]): HistoryTab<T>[] {
  const tabOf = (kind: string): HistoryTabId =>
    kind === 'character'
      ? 'heroes'
      : kind === 'chapter'
        ? 'story'
        : kind === 'dm-only' || kind === 'notes'
          ? 'notes'
          : 'tale';
  const items: Record<HistoryTabId, T[]> = { tale: [], heroes: [], story: [], notes: [] };
  for (const s of list) items[tabOf(s.kind)].push(s);
  items.notes.sort((a, b) => Number(a.kind === 'notes') - Number(b.kind === 'notes'));
  return (['tale', 'heroes', 'story', 'notes'] as const)
    .filter((id) => items[id].length > 0)
    .map((id) => ({ id, label: TAB_LABELS[id], items: items[id] }));
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
