/** Dry-humour names for a new voice group, so a DM splitting the party never has to type one. */
export const GROUP_NAMES: readonly string[] = [
  'The Sensible Ones',
  'Plan B',
  'Mostly Harmless',
  'Definitely Not a Trap',
  'Unpaid Interns',
  'The Designated Survivors',
  'Reasonable Doubt',
  'Strongly Worded Letter',
  'Self-Appointed Heroes',
  'The Committee',
  'Adequate Preparation',
  'Questionable Judgement',
  'This Could Have Been an Email',
  'Not My Department',
  'The Understudies',
  'Heroic Intentions, Pending',
  'Acceptable Losses',
  'Fine, We’ll Go',
  'Terms and Conditions Apply',
  'Cautious Optimism',
  'The Distraction',
  'Hold My Ale',
  'Lowered Expectations',
  'The Backup Plan’s Backup',
  'Probably Fine',
  'Outside Consultants',
  'Mild Peril',
  'The Smaller Party',
  'Allegedly Competent',
  'Risk Assessment Pending',
  'Reluctant Volunteers',
  'Well, That Went Poorly',
  'Strategic Retreat',
  'Lunch Break Squad',
  'Nothing to See Here',
  'The Overqualified',
  'Insured Against Dragons',
  'Rapidly Improvising',
  'Wildly Optimistic',
  'Second Breakfast Committee',
];

const ROMAN = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** A name not already used (any case). If every name is taken, the first is reused with a numeral. */
export function pickGroupName(used: readonly string[], rng: () => number = Math.random): string {
  const taken = new Set(used.map((n) => n.trim().toLowerCase()));
  const free = GROUP_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  if (free.length > 0) return free[Math.floor(rng() * free.length)]!;
  const base = GROUP_NAMES[Math.floor(rng() * GROUP_NAMES.length)]!;
  for (const numeral of ROMAN) {
    const candidate = `${base} ${numeral}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${used.length + 1}`;
}
