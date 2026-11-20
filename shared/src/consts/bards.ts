/**
 * The bard presets a Game Master picks from, per campaign (Stage 11 item 4; decided by Andy 2026-11-18: a preset
 * list, no free text, one bard per campaign, not per session). Stored and shown from 0.6.0; Stage 12 makes it
 * change how the tale is told. The ids are also the database's CHECK list (migration 0040): change both.
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

export const isBardId = (value: unknown): value is BardId =>
  typeof value === 'string' && (BARD_IDS as readonly string[]).includes(value);
