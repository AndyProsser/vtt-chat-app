import type { SummaryContext, SummaryKind } from '../types/index.js';

const GROUND_RULES = [
  'Use only what is in the transcript. Do not invent events, names or details.',
  'If something is unclear or the transcript seems garbled, say so instead of guessing.',
  'Speech was transcribed automatically, so expect misspelled names; keep the spelling the speakers most often used.',
  'Each line names who spoke or typed it; keep every action and line with the person who did or said it.',
  'Lines marked "(typed)" were typed into the table chat instead of spoken; treat them as part of the game.',
  'Ignore table chatter that is not about the game (food, breaks, technical problems).',
].join('\n- ');

function describe(kind: SummaryKind, context: SummaryContext): string {
  const campaign = context.campaignName ? ` of the campaign "${context.campaignName}"` : '';
  switch (kind) {
    case 'session':
      return `a shared summary of a tabletop role-playing session${campaign}, for all players. Cover what happened in order, key decisions, important discoveries, and unresolved threads.`;
    case 'dm-only':
      return `a private summary of a tabletop role-playing session${campaign}, for the Game Master only. Besides what happened, list secrets that were revealed or are still hidden, plot hooks players pursued or ignored, promises made to or by non-player characters, and things the Game Master should prepare for next session.`;
    case 'chapter': {
      if (!context.chapter) throw new Error('a chapter summary needs context.chapter');
      const { number, of, title } = context.chapter;
      const scene = title ? `, which began in the scene "${title}"` : '';
      return `a summary of part ${number} of ${of} of a tabletop role-playing session${campaign}${scene}, for all players (the session was paused or the scene changed between parts; this covers part ${number} only). Cover what happened in this part in order, key decisions and discoveries.`;
    }
    case 'character': {
      if (!context.characterName) {
        throw new Error('a character summary needs context.characterName');
      }
      return `a summary of a tabletop role-playing session${campaign} from the point of view of the character "${context.characterName}": what they did, saw, learned and promised, and what they might want to do next.`;
    }
  }
}

/**
 * The rules for cue lines, added only when the transcript has some. Cues are what the table heard and did
 * (a scene started, a sound played, a voice changed, the party split), noted by the app, not said by anyone:
 * they colour the telling and must never become invented story.
 */
const CUE_RULES =
  'Lines marked "(cue)" are cues noted by the app, not speech: a scene started, a sound effect played, the Game Master changed voice, the table split into groups, the Game Master took a player aside for a private talk (which is not recorded: never guess what was said). Use them only to say where and how things happened (for example, which scene the party was in, or who was in which group). They are not events: do not invent what a sound meant, who made it, or anything that no one said or typed.';

/** The rules, plus who the Game Master is when known (their lines are narration, not a character's). */
function rules(context: SummaryContext): string {
  const gm = context.gameMaster
    ? `\n- "${context.gameMaster}" is the Game Master: their lines describe the world and the non-player characters. Everyone else is a player speaking as their character.`
    : '';
  const cues = context.cues && context.cues.length > 0 ? `\n- ${CUE_RULES}` : '';
  return `Rules:\n- ${GROUND_RULES}${gm}${cues}`;
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
    rules(context),
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
    rules(context),
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
    rules(context),
    'Transcript (each line is "[time] speaker: words"):',
    transcript,
    'Summary:',
  ].join('\n\n');
}
