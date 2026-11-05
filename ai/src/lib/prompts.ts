import type { SummaryContext, SummaryKind } from '../types/index.js';

const GROUND_RULES = [
  'Use only what is in the transcript. Do not invent events, names or details.',
  'If something is unclear or the transcript seems garbled, say so instead of guessing.',
  'Speech was transcribed automatically, so expect misspelled names; keep the spelling the speakers most often used.',
  'Ignore table chatter that is not about the game (food, breaks, technical problems).',
].join('\n- ');

function describe(kind: SummaryKind, context: SummaryContext): string {
  const campaign = context.campaignName ? ` of the campaign "${context.campaignName}"` : '';
  switch (kind) {
    case 'session':
      return `a shared summary of a tabletop role-playing session${campaign}, for all players. Cover what happened in order, key decisions, important discoveries, and unresolved threads.`;
    case 'dm-only':
      return `a private summary of a tabletop role-playing session${campaign}, for the Game Master only. Besides what happened, list secrets that were revealed or are still hidden, plot hooks players pursued or ignored, promises made to or by non-player characters, and things the Game Master should prepare for next session.`;
    case 'character': {
      if (!context.characterName) {
        throw new Error('a character summary needs context.characterName');
      }
      return `a summary of a tabletop role-playing session${campaign} from the point of view of the character "${context.characterName}": what they did, saw, learned and promised, and what they might want to do next.`;
    }
  }
}

/** Prompt for one piece of a long transcript. */
export function buildChunkPrompt(
  kind: SummaryKind,
  chunk: string,
  index: number,
  total: number,
  context: SummaryContext,
): string {
  return [
    `You are helping to write ${describe(kind, context)}`,
    `This is part ${index + 1} of ${total} of the transcript. Write concise notes for this part only; they will be combined with the other parts later.`,
    `Rules:\n- ${GROUND_RULES}`,
    'Transcript (each line is "[time] speaker: words"):',
    chunk,
    'Notes for this part:',
  ].join('\n\n');
}

/** Prompt that combines notes (from chunks, or from an earlier combining pass) into the final text. */
export function buildReducePrompt(
  kind: SummaryKind,
  notes: readonly string[],
  context: SummaryContext,
  final: boolean,
): string {
  const task = final
    ? `Combine the notes below into ${describe(kind, context)} Write it as clear prose with short headed sections.`
    : `Combine the notes below into shorter notes that keep every important fact, decision and name, in order. They will be combined again later.`;
  return [
    task,
    `Rules:\n- ${GROUND_RULES}`,
    'Notes, in order:',
    notes.map((note, i) => `--- part ${i + 1} ---\n${note.trim()}`).join('\n\n'),
    final ? 'Summary:' : 'Combined notes:',
  ].join('\n\n');
}

/** Prompt when the whole transcript fits in one call. */
export function buildSinglePrompt(
  kind: SummaryKind,
  transcript: string,
  context: SummaryContext,
): string {
  return [
    `You are helping to write ${describe(kind, context)} Write it as clear prose with short headed sections.`,
    `Rules:\n- ${GROUND_RULES}`,
    'Transcript (each line is "[time] speaker: words"):',
    transcript,
    'Summary:',
  ].join('\n\n');
}
