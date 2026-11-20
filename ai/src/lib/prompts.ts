import type { SummaryContext, SummaryKind } from '../types/index.js';
import { NOTE_HEADINGS_FOR_PROMPT } from './notes.js';

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

/** The rule for loot lines: unlike other cues they are facts (the app's record of who got what). */
const LOOT_RULES =
  'Lines marked "(loot)" are the app\'s record of treasure changing hands: dropped, given, taken, put in the party stash, split, put back or taken away. They are facts: note each one, with who got what, exactly as written.';

/** The rules, plus who the Game Master is when known (their lines are narration, not a character's). */
function rules(context: SummaryContext): string {
  const gm = context.gameMaster
    ? `\n- "${context.gameMaster}" is the Game Master: their lines describe the world and the non-player characters. Everyone else is a player speaking as their character.`
    : '';
  const cues = context.cues?.some((c) => c.kind !== 'loot') ? `\n- ${CUE_RULES}` : '';
  const loot = context.loot ? `\n- ${LOOT_RULES}` : '';
  return `Rules:\n- ${GROUND_RULES}${gm}${cues}${loot}`;
}

/** The tale's treasure: only the notable loot (decided 2026-11-17), so the story is not a shopping list. */
function taleLoot(context: SummaryContext): string {
  if (!context.loot) return '';
  const { notable } = context.loot;
  return notable.length > 0
    ? `\n- Treasure worth telling, from the app's record: ${notable.join('; ')}. Tell these where they fit, as they happened; leave all other loot out of the tale.`
    : '\n- Leave all loot out of the tale: none of it this session was worth telling.';
}

/** The Game Master's full loot record, so the brief can say who has what. */
function briefLoot(context: SummaryContext): string[] {
  if (!context.loot) return [];
  return [
    `Loot this session, from the app's record (complete and exact; list it under a "Loot" heading, who got what, and leave nothing out):\n- ${context.loot.all.join('\n- ')}`,
  ];
}

const campaignOf = (context: SummaryContext): string =>
  context.campaignName ? ` of the campaign "${context.campaignName}"` : '';

/** The layout the scribe writes in (Stage 12 D): fixed headings, so the next steps can each take the part they need. */
const LAYOUT_RULES = `Write the notes under these headings, in this order, each as a Markdown "##" heading line, and leave out a heading that has nothing under it:
${NOTE_HEADINGS_FOR_PROMPT}
Events: what happened, in order, including the small things. Decisions: what the party chose or planned, and who argued for what. Combat: each fight, who took part, the rolls that mattered and how it ended. Non-player characters: who was met or named, what they said, wanted or promised. Locations: where the party went or heard of. Loot: items found, given, taken or lost (the app's loot lines, exactly). Quests: tasks taken up, finished, abandoned or left open. Secrets and reveals: what was learned that was hidden, and who learned it. Character moments: a character's growth, a fumble, a boast, a choice that shows who they are. Memorable quotes: the lines worth keeping, word for word, saying who said each (at most ten).
Every bullet is a whole sentence. A line may appear under one heading only.`;

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
      LAYOUT_RULES,
      'Under each heading write one bullet per thing, in the order things happened. For each: who did what, to whom or what, and how it turned out.',
      'Be thorough: almost every exchange in the transcript should leave a line in the notes.',
      'Never go beyond the transcript. The notes have about as many lines as the transcript has exchanges, never more: four lines of transcript make about four lines of notes. Do not continue the story, and do not describe anything that no line of the transcript says.',
      'Write whole sentences, not shorthand: no arrows, no abbreviations, no "X: roll, result" fragments. Say what a success or a failure looked like as the Game Master described it.',
      'Keep the small things as well as the big ones: a failed roll, a bad idea, a plan that went wrong, a joke or a boast made in character, a lucky escape.',
      'Note dice results when they are mentioned, above all critical hits, natural ones and other fumbles, and what they led to.',
      'Keep names of characters, places, creatures and items as the speakers said them, and quote the memorable lines word for word, saying who said them.',
      'Note what was found, taken, lost, promised or left unanswered.',
      "No story-telling and no opinions: the notes are the record that a story, and the Game Master's brief, will be written from.",
    ].join('\n'),
    rules(context),
    'Transcript (each line is "[time] speaker: words"):',
    chunk,
    'Notes:',
  ].join('\n\n');
}

/**
 * When the scribe's notes cannot be read (no headings, or nothing under them), it is asked to lay its own notes out
 * again, changing nothing else. Cheaper than reading the transcript again, which is the step after this one.
 */
export function buildNotesRepairPrompt(badNotes: string): string {
  return [
    'These are notes of a tabletop role-playing session, but they are not laid out as required. Rewrite them, changing only the layout: keep every fact, name and quote exactly as written, add nothing, and take nothing out.',
    LAYOUT_RULES,
    'Notes to lay out:',
    badNotes.trim(),
    'The notes, laid out:',
  ].join('\n\n');
}

/** Notes from several pieces of a transcript are shown part by part; a single piece is shown as it is. */
const joinNotes = (notes: readonly string[]): string =>
  notes.length === 1
    ? (notes[0] ?? '').trim()
    : notes.map((note, i) => `--- part ${i + 1} ---\n${note.trim()}`).join('\n\n');

/**
 * The scribe's notes as the Game Master reads them: Markdown, one bullet per event, a heading per part when
 * the recording had parts. Models already bullet some lines and not others; this makes them all alike.
 */
export function formatNotes(
  parts: readonly { title?: string; notes: readonly string[] }[],
): string {
  // Headed notes (Stage 12 D) keep their headings one level below the part's; plain lines become bullets.
  const bullets = (notes: readonly string[], deeper: boolean): string =>
    notes
      .flatMap((block) => block.split('\n'))
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => {
        const heading = /^##\s+(.+)$/.exec(line);
        if (heading) return `${deeper ? '####' : '###'} ${heading[1]}`;
        return `- ${line.replace(/^(?:[-*•]|\d+[.)])\s+/, '')}`;
      })
      .join('\n');
  return parts
    .map((p) => (p.title ? `### ${p.title}\n\n${bullets(p.notes, true)}` : bullets(p.notes, false)))
    .join('\n\n');
}

/** Shortens notes that have outgrown one model call, keeping the events (map-reduce's middle step). */
export function buildCondensePrompt(notes: readonly string[], context: SummaryContext): string {
  return [
    `These are a scribe's notes of a tabletop role-playing session${campaignOf(context)}, in order. Rewrite them as shorter notes, one event per line, in the same order.`,
    'Keep the headings, in the same order, and the bullets under them. Keep every event that matters to the story: the victories, the failures and fumbles, the discoveries, the promises, the memorable lines, and every name. Drop repetition and routine detail. Add nothing.',
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
      '- If your telling bends a detail, or something in the notes does not quite add up, never leave it unexplained: give it a reason that belongs in a world of magic, and a funny one if you can (a dwarf who should have sunk "bobbed up, buoyed, he insisted, by sheer spite").',
      '- Tell the moments that mattered and the people who made them. Not everyone in the notes belongs in the tale: a character or creature who did little may be left out or pass in a clause. Never list who was present, and never give someone a moment just to include them.',
      '- Nothing happens in the tale that the notes do not say happened. A plan for next time is still only a plan, and a recap is told as a recap. When the notes are short, the tale is a few sentences: never pad, and never mention the notes, the recording or what is missing.',
      '- No headings, no lists, no title.',
      `- If something was left unresolved, end with one line that starts "Next time:". If nothing was, leave that line out.${gm}${taleLoot(context)}`,
    ].join('\n'),
    "The scribe's notes of what happened, in order:",
    joinNotes(notes),
    'The tale:',
  ].join('\n\n');
}

/**
 * The Game Master's brief: a summary of the key points, to recall the last session and prepare the next one
 * (Andy, 2026-11-17). Not a story, and not the scribe's notes again: those are kept in full beside it.
 */
export function buildBriefPrompt(notes: readonly string[], context: SummaryContext): string {
  return [
    `You are helping a Game Master prepare. From the scribe's notes below, write a private brief of this tabletop role-playing session${campaignOf(context)}, for the Game Master only: what to remember from this session and what to have ready for the next.`,
    [
      `A summary of the key points, not a retelling: at most ${taleWords(250, notes)} words in all. The Game Master has the full notes; leave out routine detail, and anything that changes nothing for next time.`,
      'Short headed sections of a few brief bullet points each, plainly, with no story-telling:',
      '- Last session: the few things that happened that matter from here on, in order.',
      '- Where things stand: where the party is, what they have gained or lost, who is hurt, angry or in debt.',
      '- Open threads: secrets still hidden, questions the players asked that have no answer yet, hooks they took up and hooks they passed by.',
      '- Promises: what was promised to or by non-player characters.',
      '- Prepare for next session: what the players are most likely to do next, and what the Game Master will need ready for it.',
      'Use only what is in the notes. Leave out a section that has nothing in it, and do not say that it is empty.',
    ].join('\n'),
    ...briefLoot(context),
    "The scribe's notes of what happened, in order:",
    joinNotes(notes),
    'Brief:',
  ].join('\n\n');
}
