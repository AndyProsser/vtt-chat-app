export interface Quip {
  quote: string;
  /** A made-up character, with a few words on who they are. */
  by: string;
}

/**
 * Dry one-liners from people who never existed, shown under the campaign picker (and anywhere a screen could use a
 * smile). Keep them short, in-world and kind: they tease adventurers, never players.
 */
export const QUIPS: readonly Quip[] = [
  {
    quote: 'Initiative is just a polite word for who panics first.',
    by: 'Brannoch Deepmug, retired adventurer',
  },
  {
    quote: 'I did not fail the check. The door failed me.',
    by: 'Pip Underbough, halfling of many excuses',
  },
  {
    quote: 'Every plan survives right up until the first sneeze.',
    by: 'Ser Alaric Fennimore, knight of limited foresight',
  },
  {
    quote: 'I am not late. The adventure began before I was ready.',
    by: 'Thessaly Vane, wizard (mostly punctual)',
  },
  {
    quote: 'The dragon was not sleeping. I checked. Twice. Loudly.',
    by: 'Orrin Pell, former scout',
  },
  {
    quote: 'Taverns are the only dungeons with decent snacks.',
    by: 'Mabel Thistlewood, innkeeper',
  },
  {
    quote: 'If it glows, it is magic. If it glows and hums, it is a lawsuit.',
    by: 'Gizzik Sprocketwhistle, gnome tinkerer',
  },
  { quote: 'Never split the party. Or the bill.', by: 'Dame Rosalind Quill, guild treasurer' },
  {
    quote: 'I can explain the trap. Mostly the sound it made.',
    by: 'Wick Ashgrove, thief (semi-retired)',
  },
  {
    quote: 'Your honour, the goblin started it. The goblin also finished it.',
    by: 'Barrister Mogg Tallowby',
  },
  {
    quote: 'Hope is an excellent plan until someone rolls a one.',
    by: 'Brother Ambrose, cleric of minor luck',
  },
  {
    quote: 'Be kind to your Dungeon Master. They know where the dragons are.',
    by: 'Nessa Longfeather, bard',
  },
  {
    quote: 'The map said here be dragons. The map was being modest.',
    by: 'Odo Fenwick, cartographer',
  },
  {
    quote: 'I rolled a twenty. Nobody saw. It was glorious and wasted.',
    by: 'Kaelen Dusk, ranger of lost causes',
  },
  {
    quote: 'Silence is golden. It is also, apparently, a bad idea in a crypt.',
    by: 'Ysolde March, grave-warden',
  },
  {
    quote: 'Rest is for the wicked, and for anyone down to two hit points.',
    by: 'Garrick Stonebelly, dwarf',
  },
  {
    quote: 'I put everything into charisma. The innkeeper remains unconvinced.',
    by: 'Delphine Rook, bard',
  },
  {
    quote: 'We came for adventure. We stayed because the door locked behind us.',
    by: 'Tobias Quickfoot, hobbled but optimistic',
  },
  {
    quote: 'There are no bad ideas, only loot that has not been collected yet.',
    by: 'Hargrim Coalbeard, quartermaster',
  },
  {
    quote: 'Of course I trust you. I also trust the ice on a spring pond.',
    by: 'Maren Ashdown, healer',
  },
];

/**
 * A random quip, never `avoid` (so a screen that redraws does not show the same line twice running). `random` is
 * injectable so a test can steer it.
 */
export function pickQuip(random: () => number = Math.random, avoid?: Quip): Quip {
  const pool = avoid ? QUIPS.filter((q) => q !== avoid) : QUIPS;
  const i = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[i]!;
}
