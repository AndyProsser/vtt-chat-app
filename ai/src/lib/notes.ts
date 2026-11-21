/**
 * The scribe's notes (Stage 12 D): plain Markdown bullets under a fixed set of headings, so the steps after the
 * scribe (the bard, the Chronicler, campaign memory) can each take the part they need. "Does not have to be strict,
 * only readable by the next step" (Andy, 2026-11-17): this reads what a model wrote, forgives the usual untidiness
 * (bold or plain headings, numbered bullets, a preamble) and says whether anything usable was there.
 */

export const NOTE_SECTIONS = [
  { key: 'events', title: 'Events', aliases: ['important events', 'key events', 'what happened'] },
  { key: 'decisions', title: 'Decisions', aliases: ['plans', 'decisions and plans'] },
  { key: 'combat', title: 'Combat', aliases: ['fights', 'combat outcomes', 'battles'] },
  {
    key: 'npcs',
    title: 'Non-player characters',
    aliases: ['npcs', 'npc', 'npc interactions', 'non player characters', 'new npcs'],
  },
  { key: 'locations', title: 'Locations', aliases: ['places', 'new locations'] },
  { key: 'loot', title: 'Loot', aliases: ['treasure', 'items', 'items obtained'] },
  { key: 'quests', title: 'Quests', aliases: ['quests and hooks', 'open threads', 'hooks'] },
  {
    key: 'secrets',
    title: 'Secrets and reveals',
    aliases: ['secrets', 'secrets revealed', 'reveals', 'revelations'],
  },
  {
    key: 'moments',
    title: 'Character moments',
    aliases: ['character development', 'character', 'characters'],
  },
  {
    key: 'quotes',
    title: 'Memorable quotes',
    aliases: ['quotes', 'memorable lines', 'notable quotes'],
  },
] as const;

export type NoteSectionKey = (typeof NOTE_SECTIONS)[number]['key'];
export type StructuredNotes = Record<NoteSectionKey, string[]>;

/** About the most the notes of a whole session may run (Stage 12 D: "at most about 3,000 words"). */
export const NOTES_MAX_WORDS = 3000;

export const emptyNotes = (): StructuredNotes => ({
  events: [],
  decisions: [],
  combat: [],
  npcs: [],
  locations: [],
  loot: [],
  quests: [],
  secrets: [],
  moments: [],
  quotes: [],
});

const normaliseHeading = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[*_`#:]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SECTION_BY_NAME = new Map<string, NoteSectionKey>(
  NOTE_SECTIONS.flatMap((s) => [
    [normaliseHeading(s.title), s.key] as const,
    ...s.aliases.map((a) => [normaliseHeading(a), s.key] as const),
  ]),
);

/** A line that is a heading: Markdown `#`, a bold line, or a short line ending in a colon. */
const headingText = (line: string): string | undefined => {
  const t = line.trim();
  const md = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
  if (md) return md[1];
  const bold = /^\*\*(.+?)\*\*:?$/.exec(t);
  if (bold) return bold[1];
  const colon = /^([A-Za-z][A-Za-z -]{2,40}):$/.exec(t);
  return colon ? colon[1] : undefined;
};

const bulletText = (line: string): string =>
  line
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .trim();

/** "None", "N/A", "(nothing)" under a heading: the model saying the section is empty. */
const isEmptyMarker = (text: string): boolean =>
  /^[([]?\s*(none|n\/a|nothing|no [a-z ]+|not applicable|-)\.?\s*[)\]]?$/i.test(text);

/**
 * Reads notes a model wrote. Lines under a heading we know go to that section; lines under a heading we do not
 * know, and lines before any heading, go to Events (kept, not lost). Returns undefined when there is nothing
 * usable: no text at all, or no heading anywhere, which means the model ignored the layout.
 */
export function parseNotes(text: string): StructuredNotes | undefined {
  const notes = emptyNotes();
  let current: NoteSectionKey = 'events';
  let sawHeading = false;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || /^[-*_]{3,}$/.test(raw.trim())) continue;
    const heading = headingText(raw);
    if (heading !== undefined) {
      const key = SECTION_BY_NAME.get(normaliseHeading(heading));
      if (key) {
        current = key;
        sawHeading = true;
        continue;
      }
      // A heading we do not know ("--- part 1 ---" style, or a made-up one): its lines stay, under Events.
      current = 'events';
      continue;
    }
    const line = bulletText(raw);
    if (line === '' || isEmptyMarker(line)) continue;
    notes[current].push(line);
  }
  const total = NOTE_SECTIONS.reduce((n, s) => n + notes[s.key].length, 0);
  return sawHeading && total > 0 ? notes : undefined;
}

/** The notes as Markdown, in the fixed order; sections with nothing in them are left out. */
export function renderNotes(notes: StructuredNotes, headingLevel = 2): string {
  const hashes = '#'.repeat(headingLevel);
  return NOTE_SECTIONS.filter((s) => notes[s.key].length > 0)
    .map((s) => `${hashes} ${s.title}\n${notes[s.key].map((l) => `- ${l}`).join('\n')}`)
    .join('\n\n');
}

/** Notes from several pieces of a transcript as one: each section's lines in order, a repeat (an overlap) once. */
export function mergeNotes(parts: readonly StructuredNotes[]): StructuredNotes {
  const merged = emptyNotes();
  for (const s of NOTE_SECTIONS) {
    const seen = new Set<string>();
    for (const part of parts) {
      for (const line of part[s.key]) {
        const key = line.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);
        merged[s.key].push(line);
      }
    }
  }
  return merged;
}

export const countWords = (text: string): number =>
  text.split(/\s+/).filter((w) => w !== '').length;

export const notesWords = (notes: StructuredNotes): number =>
  NOTE_SECTIONS.reduce((n, s) => n + notes[s.key].reduce((m, l) => m + countWords(l), 0), 0);

/** The headings as the prompts list them, so the prompt and the parser agree. */
export const NOTE_HEADINGS_FOR_PROMPT = NOTE_SECTIONS.map((s) => `## ${s.title}`).join('\n');
