/**
 * The bard presets a Game Master picks from, per campaign (Stage 11 item 4; decided by Andy 2026-11-18: a preset
 * list, no free text, one bard per campaign, not per session). Stored and shown from 0.6.0; Stage 12 G makes it
 * change how the tale is told (`STYLES` in ai/src/lib/prompts.ts). The ids are also the database's CHECK list (migration 0040): change both.
 */
export const BARD_IDS = ['tavern', 'dry', 'drunken', 'sarcastic', 'bored'] as const;
export type BardId = (typeof BARD_IDS)[number];

/** The bard a campaign has until its Game Master chooses another. */
export const DEFAULT_BARD: BardId = 'tavern';

export interface BardPersona {
  id: BardId;
  name: string;
  /** One line on how this bard tells it. */
  blurb: string;
  /** Said plainly where the bard is chosen; only the tipsy minstrel has one. */
  warning?: string;
}

export const BARD_PERSONAS: readonly BardPersona[] = [
  {
    id: 'tavern',
    name: 'The Tavern Bard',
    blurb: 'Grandiose: makes the heroes legendary.',
  },
  {
    id: 'dry',
    name: 'The Dry Historian',
    blurb: 'Accurate and even, like a record.',
  },
  {
    id: 'drunken',
    name: 'The Tipsy Minstrel',
    blurb: 'An unreliable narrator: forgets, jokes, credits the wrong hero.',
    warning:
      'An agent of chaos with an insider’s view: any Game Master secret may slip into the tale, and some of it will be made up. You are choosing that.',
  },
  {
    id: 'sarcastic',
    name: 'The Wry Jester',
    blurb: 'Dry; pokes fun at the party’s decisions.',
  },
  {
    id: 'bored',
    name: 'The Bored Court Scribe',
    blurb: 'Understates everything.',
  },
];

/**
 * Operator controls over the tales (decided by Andy 2026-11-20). They are server settings (`vtt-admin settings`), not
 * a Game Master choice: the Game Master picks only a storyteller's style. They are stored and shown now; the
 * persona work (0.6.4) makes the prompts use them.
 */
export const TALE_LENGTHS = ['short', 'default', 'long'] as const;
export type TaleLength = (typeof TALE_LENGTHS)[number];
/** What each length means for the operator (the parentheses are suggestions, not rules). */
export const TALE_LENGTH_HINTS: Record<TaleLength, string> = {
  short: 'Short (CPU-only): the shortest tales, for a server with no GPU',
  default: 'Default',
  long: 'Long (GPU or cloud): longer, fuller tales',
};

export const TALE_CONTENTS = ['clean', 'default', 'graphic'] as const;
export type TaleContent = (typeof TALE_CONTENTS)[number];
export const TALE_CONTENT_HINTS: Record<TaleContent, string> = {
  clean: 'Clean: no strong language, violence kept off the page',
  default: 'Default',
  graphic: 'Graphic: violence and strong language told plainly',
};

/** The storyteller that can never be turned off: it is what every other choice falls back to. */
export const ALWAYS_ON_BARD: BardId = 'tavern';

/** The storytellers a server offers: every one except those the operator turned off (the Tavern Bard always stays). */
export const offeredBards = (off: readonly BardId[]): BardId[] =>
  BARD_IDS.filter((id) => id === ALWAYS_ON_BARD || !off.includes(id));

/** The storyteller that actually tells a tale: the campaign's choice, or the default when the operator has turned it off. */
export const effectiveBard = (chosen: BardId, off: readonly BardId[]): BardId =>
  offeredBards(off).includes(chosen) ? chosen : DEFAULT_BARD;

export const isBardId = (value: unknown): value is BardId =>
  typeof value === 'string' && (BARD_IDS as readonly string[]).includes(value);
