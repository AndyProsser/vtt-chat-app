// The scripted table for compose-e2e.ts: who is at it, what each person says and types, and in which
// order. Every line that must NEVER reach a transcript, summary or search result carries a word that
// appears nowhere else in the scene (FORBIDDEN), so "absent" is a plain text check.

export type Who = 'dm' | 'aria' | 'bram' | 'cass';

export interface CastMember {
  key: Who;
  email: string;
  displayName: string;
  /** A piper voice (file name without .onnx) — different voices make different speakers. */
  voice: string;
  character?: { name: string; className: string; race: string; level: number };
}

export const CAST: readonly CastMember[] = [
  { key: 'dm', email: 'e2e-dm@example.com', displayName: 'E2E DM', voice: 'en_GB-alan-medium' },
  {
    key: 'aria',
    email: 'e2e-aria@example.com',
    displayName: 'E2E Aria',
    voice: 'en_US-amy-medium',
    character: { name: 'Aria', className: 'Ranger', race: 'Wood elf', level: 5 },
  },
  {
    key: 'bram',
    email: 'e2e-bram@example.com',
    displayName: 'E2E Bram',
    voice: 'en_US-ryan-medium',
    character: { name: 'Bram', className: 'Cleric', race: 'Hill dwarf', level: 5 },
  },
  {
    key: 'cass',
    email: 'e2e-cass@example.com',
    displayName: 'E2E Cass',
    voice: 'en_GB-southern_english_female-low',
    character: { name: 'Cassiel', className: 'Warlock', race: 'Tiefling', level: 4 },
  },
];

/**
 * One step of the scene. `say` is spoken into the person's microphone track; `type` is entered into
 * their chat composer exactly as a person would type it (slash commands included).
 *
 * `expect` says whether the step must end up in the records: `captured` (spoken while recorded, or a
 * typed in-character line), or `absent` (spoken before the speaker acknowledged the cue or while the
 * recording was paused, or a whisper / out-of-character line).
 */
export type Step =
  | { do: 'say'; who: Who; text: string; expect: 'captured' | 'absent' }
  | { do: 'type'; who: Who; text: string; expect: 'captured' | 'absent' }
  | { do: 'start' | 'pause' | 'resume' | 'stop' }
  /** Cass arrives: WebSocket + voice, but does not acknowledge the cue yet. */
  | { do: 'late-join'; who: Who }
  /** The late joiner's app finishes playing the cue. */
  | { do: 'ack'; who: Who }
  | { do: 'wait'; seconds: number };

/** Words that appear only in lines that must never be recorded. */
export const FORBIDDEN = [
  'marmalade', // spoken by the late joiner before acknowledging the cue
  'periwinkle', // spoken while the recording was paused
  'pizza', // /ooc
  'traffic', // /late quick command (out of character)
  'zircon', // /dm whisper
  'aubergine', // /tell whisper
] as const;

/** A phrase every member must be able to find with search. */
export const SEARCH_SPOKEN = 'drowned king';
/** A typed in-character line that must be searchable as chat. */
export const SEARCH_TYPED = 'nock an arrow';

/** Recording A: two chapters around a pause, a late joiner, and every kind of chat line. */
export const RECORDING_A: readonly Step[] = [
  { do: 'start' },
  {
    do: 'say',
    who: 'dm',
    text: 'Welcome back, everyone. When we left off, you had just reached the flooded steps of the Sunken Temple.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'aria',
    text: 'I want to scout ahead quietly and check the water for anything moving.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'dm',
    text: 'Make a perception check. You notice a pale shape gliding beneath the surface, about twenty feet away.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'bram',
    text: 'I raise my holy symbol and cast light on my shield so we can all see the stairs.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'dm',
    text: 'The light reveals carvings of a drowned king holding a silver key above his head.',
    expect: 'captured',
  },
  {
    do: 'type',
    who: 'aria',
    text: 'I nock an arrow and wait for it to surface',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'aria',
    text: 'Let us not touch anything yet. Bram, can you read the inscription?',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'bram',
    text: 'It says the key opens the vault, but only for someone who pays the toll in blood.',
    expect: 'captured',
  },
  { do: 'type', who: 'bram', text: '/say Stand fast, friends!', expect: 'captured' },
  {
    do: 'type',
    who: 'aria',
    text: '/ooc running late tomorrow, pizza just arrived',
    expect: 'absent',
  },
  {
    do: 'type',
    who: 'bram',
    text: '/dm I secretly pocket the zircon from the altar',
    expect: 'absent',
  },
  { do: 'late-join', who: 'cass' },
  {
    do: 'say',
    who: 'cass',
    text: 'Sorry I am late everyone, my cat knocked the marmalade off the table.',
    expect: 'absent',
  },
  { do: 'ack', who: 'cass' },
  { do: 'wait', seconds: 6 },
  {
    do: 'say',
    who: 'cass',
    text: 'Cassiel steps out of the shadows and offers to pay the toll with her own blood.',
    expect: 'captured',
  },
  {
    do: 'type',
    who: 'cass',
    text: '/do draws a jagged dagger across her palm',
    expect: 'captured',
  },
  {
    do: 'type',
    who: 'cass',
    text: '/tell Aria the priest lied about the aubergine vault',
    expect: 'absent',
  },
  {
    do: 'say',
    who: 'dm',
    text: 'The water begins to churn as the pale shape rises toward you. Roll for initiative.',
    expect: 'captured',
  },
  { do: 'pause' },
  { do: 'wait', seconds: 4 },
  {
    do: 'say',
    who: 'bram',
    text: 'Quick break for snacks. Who wants a periwinkle biscuit?',
    expect: 'absent',
  },
  { do: 'type', who: 'aria', text: '/late stuck in traffic', expect: 'absent' },
  { do: 'resume' },
  { do: 'wait', seconds: 6 },
  {
    do: 'say',
    who: 'dm',
    text: 'The creature is a giant eel with glowing eyes, and it lunges straight at Aria.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'aria',
    text: 'I dodge behind the pillar and shoot two arrows at its eyes.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'dm',
    text: 'Both arrows hit. The eel shrieks and dives back into the dark water.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'cass',
    text: 'I cast eldritch blast into the water where it disappeared.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'bram',
    text: 'While it is distracted, I grab the silver key from the statue.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'dm',
    text: 'The key is warm in your hand, and a hidden door grinds open behind the altar. That is where we stop for tonight.',
    expect: 'captured',
  },
  { do: 'stop' },
];

/** Recording B: starting again needs a fresh acknowledgement from everyone. */
export const RECORDING_B: readonly Step[] = [
  { do: 'start' },
  {
    do: 'say',
    who: 'dm',
    text: 'Quick recap for the notes. The party has the silver key and the eel is badly wounded.',
    expect: 'captured',
  },
  {
    do: 'say',
    who: 'aria',
    text: 'Next session we go through the hidden door behind the altar.',
    expect: 'captured',
  },
  { do: 'type', who: 'cass', text: 'Cassiel bandages her bleeding hand', expect: 'captured' },
  {
    do: 'say',
    who: 'bram',
    text: 'And somebody owes me a brand new shield.',
    expect: 'captured',
  },
  { do: 'stop' },
];
