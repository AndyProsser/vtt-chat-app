/**
 * Campaign memory (Stage 12 F): what a campaign has already met, kept between sessions. After each session one model
 * call reads that session's notes and the entries already known that the notes mention, and says which entries are new
 * or have changed. Pure functions here; the job (`processRecording`) and the store do the rest.
 *
 * Small on purpose (decided with Andy, 2026-11-20): named entries with a one-line gist, so finding "Gary the Grumpy Gnome"
 * five sessions later works by name or alias, and a CPU-only server only ever puts a few hundred words of it in a prompt.
 */

export const MEMORY_KINDS = ['npc', 'creature', 'location', 'faction', 'quest', 'item'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  npc: 'person',
  creature: 'creature',
  location: 'place',
  faction: 'group',
  quest: 'quest',
  item: 'item',
};

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  name: string;
  aliases: string[];
  /** One line: who or what it is, and the last thing that mattered about it. */
  gist: string;
  /** The session that first met it, so a reprocessed session does not read its own entries back as "met before". */
  firstRecordingId: string | null;
  firstSeen: number;
  lastSeen: number;
  timesSeen: number;
}

/** What the model returns for one entry. */
export interface MemoryUpdate {
  kind: MemoryKind;
  name: string;
  aliases: string[];
  gist: string;
}

export const MEMORY_GIST_MAX_WORDS = 25;
const GIST_MAX_CHARS = 400;
const NAME_MAX_CHARS = 100;
/** The most entries one session may add or change: a session is a few dozen things at the most, and a runaway model is not memory. */
export const MEMORY_MAX_UPDATES = 30;
/** The most known entries shown to the model that updates memory, and to a tale or brief. */
export const MEMORY_MAX_SHOWN_FOR_UPDATE = 40;
export const MEMORY_MAX_SHOWN_FOR_TALE = 12;

const words = (text: string): string[] => text.split(/\s+/).filter((w) => w !== '');
const keyOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Every spelling an entry answers to, as match keys. */
const namesOf = (entry: { name: string; aliases: readonly string[] }): string[] =>
  [entry.name, ...entry.aliases].map(keyOf).filter((k) => k !== '');

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether the text mentions this name or one of its aliases, as whole words, any case. */
const mentions = (text: string, entry: { name: string; aliases: readonly string[] }): boolean =>
  [entry.name, ...entry.aliases]
    .filter((n) => keyOf(n).length >= 3)
    .some((n) =>
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(n.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(text),
    );

/**
 * The known entries a piece of text mentions, most-seen first, plus (when asked) every open quest: a quest is what the
 * party is still carrying, so it is worth showing even when the notes do not name it.
 */
export function relevantMemory(
  entries: readonly MemoryEntry[],
  text: string,
  limit: number,
  options: { alwaysQuests?: boolean; excludeFirstRecording?: string } = {},
): MemoryEntry[] {
  const pool = entries.filter(
    (e) => e.firstRecordingId === null || e.firstRecordingId !== options.excludeFirstRecording,
  );
  const named = pool.filter((e) => mentions(text, e));
  const quests = options.alwaysQuests
    ? pool.filter((e) => e.kind === 'quest' && !named.includes(e))
    : [];
  const byUse = (a: MemoryEntry, b: MemoryEntry): number =>
    b.timesSeen - a.timesSeen || b.lastSeen - a.lastSeen;
  return [...named.sort(byUse), ...quests.sort(byUse)].slice(0, limit);
}

/** An entry as one line of a prompt: "Gary the Grumpy Gnome (person; also Gary): sells lanterns in Dunmere." */
export const memoryLine = (e: Pick<MemoryEntry, 'kind' | 'name' | 'aliases' | 'gist'>): string => {
  const also = e.aliases.length > 0 ? `; also ${e.aliases.join(', ')}` : '';
  return `${e.name} (${MEMORY_KIND_LABELS[e.kind]}${also}): ${e.gist}`;
};

/** The prompt that updates memory from one session's notes. */
export function buildMemoryPrompt(
  notes: readonly string[],
  known: readonly MemoryEntry[],
  context: { campaignName?: string | undefined },
): string {
  const campaign = context.campaignName ? ` of the campaign "${context.campaignName}"` : '';
  return [
    `You keep the campaign memory of a tabletop role-playing group${campaign}: a short list of the people, creatures, places, groups, quests and items the party has met, so that later sessions can refer back to them. Read the scribe's notes of this session and say which entries are new or have changed.`,
    [
      'Answer with one entry per line, nothing else, exactly in this form:',
      'kind | name | other names, comma separated (or none) | gist',
      `kind is one of: ${MEMORY_KINDS.join(', ')}. The gist is one short sentence of at most ${MEMORY_GIST_MAX_WORDS} words: who or what it is, and the last thing that mattered about it.`,
      'Rules:',
      '- Only things the notes mention. Never invent. Leave out the player characters themselves, and anything minor that will never come up again (a passing crowd, a meal).',
      '- Keep the name as the notes spell it, and the other names the notes use for it (a title, a nickname).',
      '- For an entry already in the memory (below) that the notes mention again, give it again with its name as it is in the memory and a gist that keeps what was known and adds what is new, if anything is. Leave out an entry the notes do not mention.',
      '- A quest is a task the party took up: when the notes show it done or given up, say so in its gist.',
      `- At most ${MEMORY_MAX_UPDATES} lines. If nothing is worth keeping, answer with the single word NONE.`,
    ].join('\n'),
    known.length > 0
      ? `Already in the memory (the ones the notes may mention):\n${known.map((e) => `- ${memoryLine(e)}`).join('\n')}`
      : 'The memory is empty so far.',
    "The scribe's notes of this session:",
    notes.join('\n\n').trim(),
    'Entries:',
  ].join('\n\n');
}

/**
 * Reads the model's lines. Forgiving about bullets, quoting and a preamble; a line that is not `kind | name | ... | gist` is
 * skipped. Returns undefined only when the answer has neither entries nor an explicit NONE, which means it was not an answer.
 */
export function parseMemoryUpdate(text: string): MemoryUpdate[] | undefined {
  const out: MemoryUpdate[] = [];
  let sawNone = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '');
    if (/^none\.?$/i.test(line)) {
      sawNone = true;
      continue;
    }
    const cells = line.split('|').map((c) => c.trim().replace(/^["'`*_]+|["'`*_]+$/g, ''));
    if (cells.length < 4) continue;
    const kind = cells[0]!.toLowerCase().replace(/[^a-z]/g, '');
    const asKind = (MEMORY_KINDS as readonly string[]).includes(kind)
      ? (kind as MemoryKind)
      : kind === 'person' || kind === 'character' || kind === 'npcs'
        ? 'npc'
        : kind === 'place'
          ? 'location'
          : kind === 'group' || kind === 'organisation' || kind === 'organization'
            ? 'faction'
            : undefined;
    const name = cells[1]!.slice(0, NAME_MAX_CHARS);
    // The gist is the last cell; a stray "|" in it would have split it, so take everything after the aliases.
    const gist = cells.slice(3).join(' | ').trim();
    if (!asKind || name === '' || gist === '') continue;
    const aliases = /^(none|n\/a|-)?$/i.test(cells[2]!)
      ? []
      : cells[2]!
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a !== '' && keyOf(a) !== keyOf(name));
    out.push({
      kind: asKind,
      name,
      aliases: [...new Set(aliases)].slice(0, 6),
      gist: shortGist(gist),
    });
    if (out.length >= MEMORY_MAX_UPDATES) break;
  }
  return out.length > 0 || sawNone ? out : undefined;
}

/** At most `MEMORY_GIST_MAX_WORDS` words (and 400 characters), cut at a word. */
export function shortGist(text: string): string {
  const w = words(text);
  const cut = w.slice(0, MEMORY_GIST_MAX_WORDS).join(' ');
  return (
    (cut.length > GIST_MAX_CHARS ? cut.slice(0, GIST_MAX_CHARS).replace(/\s+\S*$/, '') : cut) +
    (w.length > MEMORY_GIST_MAX_WORDS ? '…' : '')
  );
}

/**
 * Applies a model's update to what is known: an entry the update names (by name or any alias, whole words, any case) is
 * updated in place, otherwise a new one is made. Returns only the entries that are new or changed, ready for the store to
 * save; `newId` supplies ids so the tests need no randomness.
 */
export function applyMemoryUpdate(
  known: readonly MemoryEntry[],
  updates: readonly MemoryUpdate[],
  context: { recordingId: string; now: number; newId: () => string },
): MemoryEntry[] {
  const byName = new Map<string, MemoryEntry>();
  for (const e of known) for (const k of namesOf(e)) byName.set(k, e);
  const touched = new Map<string, MemoryEntry>();
  for (const u of updates) {
    const match = namesOf(u)
      .map((k) => byName.get(k))
      .find((e) => e !== undefined);
    const base: MemoryEntry = match
      ? (touched.get(match.id) ?? match)
      : {
          id: context.newId(),
          kind: u.kind,
          name: u.name,
          aliases: [],
          gist: u.gist,
          firstRecordingId: context.recordingId,
          firstSeen: context.now,
          lastSeen: context.now,
          timesSeen: 0,
        };
    const aliases = [
      ...new Set([
        ...base.aliases,
        ...u.aliases,
        ...(match && keyOf(match.name) !== keyOf(u.name) ? [u.name] : []),
      ]),
    ]
      .filter((a) => keyOf(a) !== keyOf(base.name))
      .slice(0, 8);
    // A second line for the same entry in one answer counts once for this session.
    const first = !touched.has(base.id);
    const next: MemoryEntry = {
      ...base,
      aliases,
      gist: u.gist,
      lastSeen: context.now,
      timesSeen: first ? base.timesSeen + 1 : base.timesSeen,
    };
    touched.set(next.id, next);
    for (const k of namesOf(next)) byName.set(k, next);
  }
  return [...touched.values()];
}
