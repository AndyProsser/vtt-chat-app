import { DEFAULT_BARD, type BardId, type TaleContent, type TaleLength } from '@vtt-chat-app/shared';

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
      'Write a summary of events and actions, not a line-by-line retelling: these notes must end up noticeably shorter than the transcript above. Merge a back-and-forth about one small thing into a single line, and leave out table talk that is not part of the game. Never drop a distinct event, decision, roll that mattered, or quote to save space; shorten the telling of it instead.',
      'Never go beyond the transcript: do not continue the story, and do not describe anything that no line of the transcript says.',
      'Write whole sentences, not shorthand: no arrows, no abbreviations, no "X: roll, result" fragments. Keep each one short, a single clause of who did what and how it turned out, not a paragraph.',
      'Keep the small things as well as the big ones: a failed roll, a bad idea, a plan that went wrong, a joke or a boast made in character, a lucky escape. A line is still worth keeping even when it is brief.',
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

/**
 * The stored notes of a chaptered session read back into one block of notes per chapter, keyed by the chapter's number: the
 * inverse of `formatNotes` for parts titled "Part N" or "Part N: title". A job that failed after the notes were stored
 * (an hour of work) then starts from them instead of taking them again. Anything that does not read as that layout gives an
 * empty map, and the caller takes the notes afresh.
 */
export function parseStoredNotes(text: string): Map<string, string[]> {
  const parts = new Map<string, string[]>();
  const pieces = text.split(/^### Part (?=\S)/m).slice(1);
  for (const piece of pieces) {
    const head = /^(\S+?)(?::[^\n]*)?\n/.exec(piece);
    if (!head?.[1]) return new Map();
    const body = piece
      .slice(head[0].length)
      .split('\n')
      .map((line) => line.replace(/^####\s+/, '## '))
      .join('\n')
      .trim();
    if (body === '') return new Map();
    parts.set(head[1], [body]);
  }
  return parts;
}

/** Shortens notes that have outgrown one model call, keeping the events (map-reduce's middle step). */
export function buildCondensePrompt(
  notes: readonly string[],
  context: SummaryContext,
  targetWords?: number,
  lastAttemptWords?: number,
): string {
  return [
    `These are a scribe's notes of a tabletop role-playing session${campaignOf(context)}, in order. Rewrite them as a short recap, one event per line, in the same order: only the bits a table would want to remember at the next session.`,
    'Keep the headings, in the same order, and the bullets under them. Keep the key events and turning points, the victories and the fumbles, the discoveries and reveals, the decisions that had consequences, the promises, the memorable or funny moments and lines, and every name that matters. Drop play-by-play, routine detail, repetition and filler: merge lines about the same small thing and say each one in fewer words. Add nothing.',
    targetWords === undefined
      ? 'Cut the length by at least a third, and more where you can. A pass that barely shortens the notes has not done its job.'
      : `Write at most ${targetWords} words in total. This is a hard limit: a recap over it is cut off without being read.${
          lastAttemptWords === undefined
            ? ''
            : ` Your last attempt was ${lastAttemptWords} words, too long: cut it down to the limit by dropping the least important lines.`
        }`,
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

/**
 * The most a session's tale may run, by the operator's `ai.tale.length` (retuned 2026-11-22, Andy, after reading
 * a real session's tale and notes back: 250 to 500 words, a one‑to‑three‑minute read, not the 300 to 800 first
 * tried on 2026-11-20. 500 is for a long or eventful session, not the default).
 */
export const TALE_CAP_WORDS: Record<TaleLength, number> = { short: 250, default: 350, long: 500 };

/** A chapter's or a character's tale runs to half a session's. */
const capFor = (kind: Exclude<SummaryKind, 'dm-only'>, context: SummaryContext): number => {
  const session = TALE_CAP_WORDS[context.taleLength ?? 'default'];
  return kind === 'session' ? session : Math.round(session / 2);
};

/** What the operator's content setting asks of the telling (`ai.tale.content`). */
const CONTENT_RULES: Record<TaleContent, string | undefined> = {
  clean:
    '- Keep the language clean and the violence off the page: a foe falls, with no more of how than that.',
  default: undefined,
  graphic:
    '- Violence and strong language may be told plainly, as the table played it, where the notes have them.',
};

/** What the bard is telling, and how long it may run. Key moments, not minutes. */
function tale(
  kind: Exclude<SummaryKind, 'dm-only'>,
  context: SummaryContext,
  notes: readonly string[],
): string {
  const words = taleWords(capFor(kind, context), notes);
  switch (kind) {
    case 'session':
      return `Tell the tale of this session${campaignOf(context)} to the players who lived it. At most ${words} words, and shorter when little happened: a night of talk with little action gets a short tale.`;
    case 'chapter': {
      if (!context.chapter) throw new Error('a chapter summary needs context.chapter');
      const { number, of, title } = context.chapter;
      const scene = title ? `, which began in the scene "${title}"` : '';
      return `Tell the tale of part ${number} of ${of} of this session${campaignOf(context)}${scene} (the table paused or the scene changed between parts; tell this part only). At most ${words} words.`;
    }
    case 'character': {
      if (!context.characterName) {
        throw new Error('a character summary needs context.characterName');
      }
      return `Tell the tale of this session${campaignOf(context)} as the story of "${context.characterName}": what they dared, what they achieved, what went wrong for them, and what they are left wanting. The others appear only where they cross this hero's path. At most ${words} words, in the third person.`;
    }
  }
}

/**
 * The storytellers (Stage 12 G; Andy's memos, 2026-11-17, and the decisions of 2026-11-17 and 2026-11-20). Each is a
 * voice: what it is like to hear, never different facts. `secrets` is true only for the Tipsy Minstrel, whom the
 * Game Master chose knowing it may let a Game Master secret slip.
 */
const STYLES: Record<BardId, { title: string; how: string[]; secrets?: true }> = {
  tavern: {
    title: 'the Tavern Bard',
    how: [
      "- Glorious prose, past tense: the heroes' great feats told as legend, and their humiliating fumbles told just as proudly. A plan that failed, a roll that betrayed them, a dumb idea that somehow worked: these are the best parts.",
      '- Dry wit and gallows humour. Understate the disasters. Never explain a joke, never address the audience, never praise the story.',
      '- You may embellish HOW a thing happened (the look of it, the sound of it, a wry aside).',
      '- If your telling bends a detail, or something in the notes does not quite add up, never leave it unexplained: give it a reason that belongs in a world of magic, and a funny one if you can (a dwarf who should have sunk "bobbed up, buoyed, he insisted, by sheer spite").',
    ],
  },
  dry: {
    title: 'the Dry Historian',
    how: [
      '- Write like a historical record: even, measured, past tense, in whole formal sentences ("On the third day within the keep, the party met and bested a beholder"). No exclamation marks, no jokes, no flourishes.',
      '- Embellish almost nothing. Where the notes give a roll, a quote or a number, the record may keep it.',
      '- A fumble is recorded as exactly what it was, without comment.',
    ],
  },
  drunken: {
    title: 'the Tipsy Minstrel',
    secrets: true,
    how: [
      '- You are an unreliable narrator, some six ales into the night. You tell it warmly, loudly and with jokes, and you are pure chaos with nods to the truth: stay close to what happened, but you forget details, mix up names, credit the wrong hero, stretch a victory, and add a fact now and then because it is more fun.',
      '- Wander off for a clause and come back. Admit you may have the order wrong, once, and never explain a joke.',
      '- Let the essence of the truth survive: the party, the place and how it ended are recognisable, whatever else you bend.',
    ],
  },
  sarcastic: {
    title: 'the Wry Jester',
    how: [
      '- Dry humour, slightly cynical, and the party is the target: poke fun at their decisions and plans ("the party once again showed their signature tactical brilliance by attempting diplomacy after setting fire to the building"). Affectionate, never cruel.',
      '- The jokes are about what the notes say happened. Never explain a joke, and never address the audience.',
      '- A real triumph may be admitted, grudgingly.',
    ],
  },
  bored: {
    title: 'the Bored Court Scribe',
    how: [
      '- Disinterested and understated: short flat sentences, everything the same size ("Another dragon appeared. It was slain. Everyone seemed pleased."). The more extraordinary the event, the less the scribe cares.',
      '- No flourishes and no enthusiasm. The deadpan is the joke: never explain it.',
    ],
  },
};

/** The start of the Game Master's notes a prompt may carry, so one page of planning cannot swamp a small model. */
export const GM_NOTES_PROMPT_CHARS = 6000;

const gmNotesBlock = (text: string | undefined): string | undefined =>
  text && text.trim() !== '' ? text.trim().slice(0, GM_NOTES_PROMPT_CHARS) : undefined;

/** Earlier sessions' memory, for a tale or the brief; undefined when there is none. */
const memoryBlock = (context: SummaryContext, use: string): string[] =>
  context.memory && context.memory.length > 0
    ? [
        `From earlier sessions (what the campaign already knows of these; ${use}):\n${context.memory.map((l) => `- ${l}`).join('\n')}`,
      ]
    : [];

/** The bard's prompt: a retelling in the campaign's storyteller's voice, written from the scribe's notes, never from the transcript. */
export function buildStoryPrompt(
  kind: Exclude<SummaryKind, 'dm-only'>,
  notes: readonly string[],
  context: SummaryContext,
): string {
  const style = STYLES[context.storyteller ?? DEFAULT_BARD];
  const chaos = style.secrets === true;
  const gm = context.gameMaster
    ? `\n- "${context.gameMaster}" is the Game Master, the voice of the world and its creatures: never a character in the tale, and never named in it.`
    : '';
  // Only the Tipsy Minstrel ever sees the Game Master's notes; any other storyteller is given none, whatever the context holds.
  const secrets = chaos ? gmNotesBlock(context.gmNotes) : undefined;
  const closeness = chaos
    ? '- Names of the heroes and the places stay as the notes have them, so the table knows whose tale it is.'
    : '- Keep close to the facts: who did it, what came of it, who won, what was found, and every name stay as the notes have them. A little invention in how it is told is fine, but no new events, characters, treasure or speeches that change what happened.';
  const quotes =
    "- The notes keep memorable quotes. Use one or two where they fit, in the speaker's own words.";
  const content = CONTENT_RULES[context.taleContent ?? 'default'];
  return [
    `You are the bard of a tabletop role-playing group, ${style.title}. ${tale(kind, context, notes)}`,
    [
      'How to tell it:',
      ...style.how,
      closeness,
      quotes,
      "- Rarely, and only when the notes name the language being spoken, set the foreign words as a link, [the words](lang:<language>), for example [Khazad ul barak](lang:dwarvish), using the language's plain name (dwarvish, elvish, goblin, orc, and so on). It is a way of showing the words in that language's lettering; it adds nothing to the story, and nothing else is ever put in a link.",
      '- Tell the moments that mattered and the people who made them. Not everyone in the notes belongs in the tale: a character or creature who did little may be left out or pass in a clause. Never list who was present, and never give someone a moment just to include them.',
      ...(chaos
        ? [
            "- You may let a secret from the Game Master's own notes (below) slip, as a drunk does: a throwaway line, half-understood, never explained. Anything you let slip is told as gossip, not fact.",
          ]
        : [
            '- Nothing happens in the tale that the notes do not say happened. A plan for next time is still only a plan, and a recap is told as a recap.',
          ]),
      '- When the notes are short, the tale is a few sentences: never pad, and never mention the notes, the recording or what is missing.',
      kind === 'session'
        ? '- Begin with one line that is the title of the session as you would announce it: two to six words, written as "# The Weeping Anchor" (a heading, then a blank line, then the tale). The title names a place, a person or the turn of events, in your own voice, and never the table, the dice or the date. No other headings, no lists.'
        : '- No headings, no lists, no title.',
      ...(content ? [content] : []),
      `- If something was left unresolved, end with one line that starts "Next time:". If nothing was, leave that line out.${gm}${taleLoot(context)}`,
    ].join('\n'),
    ...(secrets
      ? [
          `The Game Master's own notes, the start of them (what they know and have planned; you have read them over their shoulder):\n${secrets}`,
        ]
      : []),
    ...memoryBlock(
      context,
      'refer back to one only where this session\'s notes show the party meeting, recalling or hearing of it again, as "once again" or "as before"; never bring one in otherwise, and never change what it is',
    ),
    "The scribe's notes of what happened, in order:",
    joinNotes(notes),
    'The tale:',
  ].join('\n\n');
}

/** What the Chronicler writes under, in order (Stage 12 E); the prompt and the tests share it. */
export const CHRONICLER_HEADINGS = [
  'Non-player characters',
  'Open threads',
  'Items',
  'Locations',
  'Hooks',
  'Continuity warnings',
] as const;

/**
 * The Chronicler's brief (Stage 12 E; it replaces the Game Master brief's content): what the Game Master needs to run the
 * next session, 150 to 250 words under fixed headings (retuned 2026-11-22, down from 200 to 300), from the
 * scribe's notes and the Game Master's own notes. A role of its own, not a bard: plain and useful, no story.
 */
export function buildChroniclerPrompt(notes: readonly string[], context: SummaryContext): string {
  const planned = gmNotesBlock(context.gmNotes);
  return [
    `You are the Chronicler of a tabletop role-playing group. From the scribe's notes below, write a private brief of this session${campaignOf(context)}, for the Game Master only: what they need to run the next session.`,
    [
      `Plain and short: 150 to 250 words in all (at most ${taleWords(250, notes)}), as brief bullet points under these headings, in this order, each as a Markdown "##" heading line. Leave out a heading that has nothing under it, and never say that one is empty.`,
      ...CHRONICLER_HEADINGS.map((h) => `## ${h}`),
      "Non-player characters: who the party met or heard of, and what each wants, promised or was promised. Open threads: questions with no answer yet, secrets still hidden, tasks taken up and not finished. Items: what was obtained, lost or promised (the app's loot record is exact). Locations: where the party went, and where they said they would go. Hooks: what the players are likely to do next, and what the Game Master will need ready for it. Continuity warnings: promises with a deadline, a debt, a wounded or angry non-player character, and anything this session said that contradicts what the Game Master planned or wrote.",
      planned
        ? "The Game Master's own notes (below) are what they know and planned. Use them to link open threads to their plans, and to flag a continuity warning where the session went against them. Do not copy them out."
        : '',
      'Use only what is in the notes. No story-telling, no embellishment, no opinions.',
    ]
      .filter((line) => line !== '')
      .join('\n'),
    ...briefLoot(context),
    ...(planned ? [`The Game Master's own notes, the start of them:\n${planned}`] : []),
    ...memoryBlock(
      context,
      'use it for continuity: say where one of these came back, changed or was left open',
    ),
    "The scribe's notes of what happened, in order:",
    joinNotes(notes),
    'Brief:',
  ].join('\n\n');
}
