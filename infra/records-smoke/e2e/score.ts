// Word accuracy for compose-e2e.ts: how close a speaker's transcript is to what their script said.
// Deliberately simple: lowercase, strip punctuation, spell out nothing, then a word-level edit distance.
// accuracy = 1 - (substitutions + deletions + insertions) / words in the script, floored at 0
// (that is 1 - WER).

export function normalise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
}

export function wordEdits(expected: readonly string[], actual: readonly string[]): number {
  let prev = Array.from({ length: actual.length + 1 }, (_, j) => j);
  for (let i = 1; i <= expected.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= actual.length; j += 1) {
      const cost = expected[i - 1] === actual[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = row;
  }
  return prev[actual.length]!;
}

export function wordAccuracy(expected: string, actual: string): number {
  const e = normalise(expected);
  if (e.length === 0) return normalise(actual).length === 0 ? 1 : 0;
  return Math.max(0, 1 - wordEdits(e, normalise(actual)) / e.length);
}

/** Whether `text` contains `word` as a whole word, ignoring case. */
export function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}
