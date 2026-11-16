import type { SummaryContext, SummaryKind } from '../types/index.js';

// A recording is summarised in two passes, by two roles (decided 2026-11-16, RECORDING-AND-SUMMARIES.md):
//
//   1. The SCRIBE reads the transcript and writes down what happened, as accurately and as fully as it can:
//      every event, big or small. Accuracy lives here.
//   2. The BARD reads the scribe's notes (never the transcript) and tells the tale: short, heroic, dryly funny.
//      The story is what the table remembers; the transcript stays searchable for anyone who wants the record.
//
// The Game Master's own summary is the exception: it is a working brief, written plainly from the same notes.

const GROUND_RULES = [
  'Use only what is in the transcript. Do not invent events, names or details.',
  'If something is unclear or the transcript seems garbled, say so instead of guessing.',
  'Speech was transcribed automatically, so expect misspelled names; keep the spelling the speakers most often used.',
  'Each line names who spoke or typed it; keep every action and line with the person who did or said it.',
  'Lines marked "(typed)" were typed into the table chat instead of spoken; treat them as part of the game.',
  'Ignore table chatter that is not about the game (food, breaks, technical problems).',
].join('\n- ');

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

const campaignOf = (context: SummaryContext): string =>
  context.campaignName ? ` of the campaign "${context.campaignName}"` : '';

/** The scribe's prompt for one piece of the transcript (the whole of it, when it fits). */
export function buildNotesPrompt(
  chunk: string,
  index: number,
  total: number,
  context: SummaryContext,
): string {
  const part =
    total > 1
      ? ` This is part ${index + 1} of ${total} of the transcript; write notes for this part only.`
      : '';
  return [
    `You are the scribe of a tabletop role-playing group. Write down what happened in this session${campaignOf(context)}, as accurately and as fully as you can.${part}`,
    [
      'Write plain notes, one event per line, in the order things happened. For each: who did what, to whom or what, and how it turned out.',
      'Be thorough: almost every exchange in the transcript should leave a line in the notes.',
      'Never go beyond the transcript. The notes have about as many lines as the transcript has exchanges, never more: four lines of transcript make about four lines of notes. Do not continue the story, and do not describe anything that no line of the transcript says.',
      'Write whole sentences, not shorthand: no arrows, no abbreviations, no "X: roll, result" fragments. Say what a success or a failure looked like as the Game Master described it.',
      'Keep the small things as well as the big ones: a failed roll, a bad idea, a plan that went wrong, a joke or a boast made in character, a lucky escape.',
      'Note dice results when they are mentioned, above all critical hits, natural ones and other fumbles, and what they led to.',
      'Keep names of characters, places, creatures and items as the speakers said them, and quote the memorable lines word for word, saying who said them.',
      'Note what was found, taken, lost, promised or left unanswered.',
      'No story-telling, no opinions, no headings: the notes are the record that a story will be written from.',
    ].join('\n'),
    rules(context),
    'Transcript (each line is "[time] speaker: words"):',
    chunk,
    'Notes:',
  ].join('\n\n');
}

/** Notes from several pieces of a transcript are shown part by part; a single piece is shown as it is. */
const joinNotes = (notes: readonly string[]): string =>
  notes.length === 1
    ? (notes[0] ?? '').trim()
    : notes.map((note, i) => `--- part ${i + 1} ---\n${note.trim()}`).join('\n\n');

/** Shortens notes that have outgrown one model call, keeping the events (map-reduce's middle step). */
export function buildCondensePrompt(notes: readonly string[], context: SummaryContext): string {
  return [
    `These are a scribe's notes of a tabletop role-playing session${campaignOf(context)}, in order. Rewrite them as shorter notes, one event per line, in the same order.`,
    'Keep every event that matters to the story: the victories, the failures and fumbles, the discoveries, the promises, the memorable lines, and every name. Drop repetition and routine detail. Add nothing.',
    'Notes, in order:',
    joinNotes(notes),
    'Shorter notes:',
  ].join('\n\n');
}

/**
 * How many words a tale may run: the kind's cap, or less when the notes are short. A bard given six lines of
 * notes and "at most 350 words" fills the space with invention (seen 2026-11-16: a four-line recap became a
 * dungeon crawl), so the limit follows the notes: a tale is never longer than what it retells.
 */
export function taleWords(cap: number, notes: readonly string[]): number {
  const words = notes
    .join(' ')
    .split(/\s+/)
    .filter((w) => w !== '').length;
  return Math.min(cap, Math.max(30, Math.round((words * 0.8) / 10) * 10));
}

/** What the bard is telling, and how long it may run. Short on purpose: key moments, not minutes. */
function tale(
  kind: Exclude<SummaryKind, 'dm-only'>,
  context: SummaryContext,
  notes: readonly string[],
): string {
  switch (kind) {
    case 'session':
      return `Tell the tale of this session${campaignOf(context)} to the players who lived it. Key moments only: at most ${taleWords(350, notes)} words.`;
    case 'chapter': {
      if (!context.chapter) throw new Error('a chapter summary needs context.chapter');
      const { number, of, title } = context.chapter;
      const scene = title ? `, which began in the scene "${title}"` : '';
      return `Tell the tale of part ${number} of ${of} of this session${campaignOf(context)}${scene} (the table paused or the scene changed between parts; tell this part only). Key moments only: at most ${taleWords(200, notes)} words.`;
    }
    case 'character': {
      if (!context.characterName) {
        throw new Error('a character summary needs context.characterName');
      }
      return `Tell the tale of this session${campaignOf(context)} as the story of "${context.characterName}": what they dared, what they achieved, what went wrong for them, and what they are left wanting. The others appear only where they cross this hero's path. At most ${taleWords(200, notes)} words, in the third person.`;
    }
  }
}

/** The bard's prompt: a short heroic retelling written from the scribe's notes, never from the transcript. */
export function buildStoryPrompt(
  kind: Exclude<SummaryKind, 'dm-only'>,
  notes: readonly string[],
  context: SummaryContext,
): string {
  const gm = context.gameMaster
    ? `\n- "${context.gameMaster}" is the Game Master, the voice of the world and its creatures: never a character in the tale, and never named in it.`
    : '';
  return [
    `You are the bard of a tabletop role-playing group. ${tale(kind, context, notes)}`,
    [
      'How to tell it:',
      "- Glorious prose, past tense: the heroes' great feats told as legend, and their humiliating fumbles told just as proudly. A plan that failed, a roll that betrayed them, a dumb idea that somehow worked: these are the best parts.",
      '- Dry wit and gallows humour. Understate the disasters. Never explain a joke, never address the audience, never praise the story.',
      '- You may embellish HOW a thing happened (the look of it, the sound of it, a wry aside). You may not change WHAT happened: who did it, what came of it, who won, what was found, and every name stay exactly as the notes have them. No new events, characters, treasure or speeches.',
      '- Nothing happens in the tale that the notes do not say happened. A plan for next time is still only a plan, and a recap is told as a recap. When the notes are short, the tale is a few sentences: never pad, and never mention the notes, the recording or what is missing.',
      '- No headings, no lists, no title.',
      `- If something was left unresolved, end with one line that starts "Next time:". If nothing was, leave that line out.${gm}`,
    ].join('\n'),
    "The scribe's notes of what happened, in order:",
    joinNotes(notes),
    'The tale:',
  ].join('\n\n');
}

/** The Game Master's working brief: plain and practical, from the same notes. Not a story. */
export function buildBriefPrompt(notes: readonly string[], context: SummaryContext): string {
  return [
    `You are helping a Game Master prepare. From the scribe's notes below, write a private brief of this tabletop role-playing session${campaignOf(context)}, for the Game Master only.`,
    [
      'Write short headed sections, plainly, with no story-telling:',
      '- What happened, in order, in a few lines.',
      '- Secrets that were revealed, and secrets still hidden.',
      '- Plot hooks the players pursued, and ones they ignored.',
      '- Promises made to or by non-player characters.',
      '- What to prepare for next session.',
      'Use only what is in the notes. Leave out a section that has nothing in it, and do not say that it is empty.',
    ].join('\n'),
    "The scribe's notes of what happened, in order:",
    joinNotes(notes),
    'Brief:',
  ].join('\n\n');
}
