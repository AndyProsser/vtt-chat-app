import type { IconName } from '../consts/icons.js';

/**
 * A little easter egg for `/do` lines: a best guess at the picture for an action from its first word. It never changes the text
 * and never decides anything; a word it does not know shows the skill icon. Singular, plural, -ing and -ed all count
 * ("jump", "jumps", "jumping", "jumped"). Only the first word is read: digging for a later one is where wrong guesses begin.
 */
const GROUPS: [IconName, string[]][] = [
  [
    'actionVoice',
    ['shout', 'yell', 'scream', 'call', 'cry', 'bellow', 'roar', 'holler', 'announce', 'declare'],
  ],
  ['actionSong', ['sing', 'hum', 'whistle', 'play', 'strum', 'chant']],
  ['actionDance', ['dance', 'twirl', 'spin', 'jig', 'waltz']],
  ['actionJump', ['jump', 'leap', 'hop', 'dive', 'vault', 'bounce']],
  ['actionRun', ['run', 'dash', 'sprint', 'flee', 'charge', 'rush', 'race', 'bolt']],
  [
    'actionGrab',
    ['take', 'catch', 'grab', 'snatch', 'lift', 'pick', 'seize', 'hold', 'carry', 'pocket'],
  ],
  ['actionSteal', ['steal', 'pinch', 'swipe', 'pilfer', 'lift']],
  ['actionGreet', ['nod', 'bow', 'greet', 'wave', 'salute', 'curtsy', 'shake', 'smile']],
  ['actionPoint', ['point', 'gesture', 'indicate']],
  ['actionCast', ['cast', 'conjure', 'summon', 'invoke', 'enchant', 'channel']],
  ['actionHide', ['hide', 'sneak', 'crouch', 'duck', 'creep', 'skulk', 'lurk']],
  [
    'actionAttack',
    [
      'attack',
      'strike',
      'hit',
      'swing',
      'slash',
      'stab',
      'shoot',
      'punch',
      'kick',
      'throw',
      'fire',
    ],
  ],
  [
    'actionLook',
    ['look', 'search', 'inspect', 'examine', 'peer', 'study', 'watch', 'stare', 'glance', 'scan'],
  ],
  ['actionListen', ['listen', 'eavesdrop', 'hear']],
  ['actionSleep', ['sleep', 'snore', 'yawn', 'rest', 'nap', 'doze']],
  ['actionEat', ['eat', 'munch', 'chew', 'nibble', 'devour']],
  ['actionDrink', ['drink', 'sip', 'gulp', 'toast', 'swig', 'quaff']],
  ['actionLaugh', ['laugh', 'giggle', 'chuckle', 'grin', 'snicker', 'cackle']],
  ['actionOpen', ['open', 'unlock', 'knock', 'push', 'enter']],
  ['actionClimb', ['climb', 'scale', 'clamber', 'scramble']],
  ['actionSwim', ['swim', 'wade', 'splash', 'paddle']],
  ['actionPray', ['pray', 'kneel', 'bless', 'worship']],
];

const BY_WORD = new Map<string, IconName>();
// The first group to claim a word wins ("lift" is a grab, not a steal).
for (const [icon, words] of GROUPS)
  for (const w of words) if (!BY_WORD.has(w)) BY_WORD.set(w, icon);

const DOUBLED = /([b-df-hj-np-tv-z])\1$/;

/** The plausible base forms of a word: "dances", "danced" and "dancing" all give "dance". */
function stems(word: string): string[] {
  const out = [word];
  const add = (b: string) => {
    out.push(b);
    if (DOUBLED.test(b)) out.push(b.slice(0, -1)); // nodding, running
  };
  if (word.endsWith('ies')) out.push(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('s')) add(word.slice(0, -1));
  if (word.endsWith('ing')) {
    const b = word.slice(0, -3);
    add(b);
    out.push(`${b}e`);
  }
  if (word.endsWith('ed')) {
    const b = word.slice(0, -2);
    add(b);
    out.push(`${b}e`);
  }
  return out;
}

/** The icon for an action line, from its first word; `action` (the skill icon) when the word is not known. */
export function actionIconName(text: string): IconName {
  const first = /[a-z]+/i.exec(text.trim())?.[0]?.toLowerCase();
  if (!first) return 'action';
  const lead = text.trim().replace(/^[^a-z]*/i, '');
  // Only the first word: "quietly jumps" is not a jump.
  if (!lead.toLowerCase().startsWith(first)) return 'action';
  for (const s of stems(first)) {
    const icon = BY_WORD.get(s);
    if (icon) return icon;
  }
  return 'action';
}
