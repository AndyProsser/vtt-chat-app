import type { Segment } from '../types/index.js';

/**
 * A campaign's vocabulary: the names Whisper tends to mishear (Stage 12, steps B and C). It is gathered by the
 * records store from what the server already holds (the Game Master's glossary, characters, players, handout and
 * loot titles, the Game Master's scene names) and used twice: as Whisper's starting prompt, and to correct what
 * Whisper wrote. Both are pure functions of the vocabulary, so they are tested without a model.
 */
export interface VocabularyTerm {
  /** The right spelling. */
  term: string;
  /** Spellings that are known to be wrong for it (the Game Master's aliases): replaced exactly. */
  aliases: string[];
  /** Lower comes first when the prompt is full: the Game Master's own terms before a loot title. */
  rank: number;
}

/** Whisper reads the last 224 tokens of its prompt; names run about 3 tokens each, so this is a safe ceiling. */
export const WHISPER_PROMPT_MAX_CHARS = 600;

/** The starting prompt: a short sentence of the names, best first, whole terms only. `undefined` when there are none. */
export function buildWhisperPrompt(
  terms: readonly VocabularyTerm[],
  maxChars = WHISPER_PROMPT_MAX_CHARS,
): string | undefined {
  const seen = new Set<string>();
  const picked: string[] = [];
  let length = 'Names in this game: .'.length;
  for (const t of [...terms].sort((a, b) => a.rank - b.rank)) {
    const key = t.term.toLowerCase();
    if (seen.has(key)) continue;
    const cost = t.term.length + 2;
    if (length + cost > maxChars) continue;
    seen.add(key);
    picked.push(t.term);
    length += cost;
  }
  return picked.length > 0 ? `Names in this game: ${picked.join(', ')}.` : undefined;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Edit distance with transposition (a swapped pair of letters is one slip). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/** Fewest letters a term needs before fuzzy matching may touch it: short names would swallow ordinary words. */
const FUZZY_MIN_LETTERS = 5;
/** One slip per five letters, never more than two. */
const allowedSlips = (letters: number): number => Math.min(2, Math.floor(letters / 5));

const letters = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const isCapitalised = (word: string): boolean => /^\p{Lu}/u.test(word);

/**
 * Corrections after transcription, in two steps. **Dictionary:** a known wrong spelling (an alias) becomes the term,
 * whole words only, any case. **Fuzzy:** a capitalised run of words one or two slips away from a long term becomes
 * the term (Whisper writes a name it half-knows with a capital: "Ravenshaid" for "Ravenshade"). The same first
 * letter, the capital and the length floor keep ordinary words from being touched; a word that is itself a term is
 * left alone. Returns the same segments, with `text` changed where a correction applied.
 */
export function correctSegments(
  segments: readonly Segment[],
  terms: readonly VocabularyTerm[],
): Segment[] {
  if (terms.length === 0) return segments.map((s) => ({ ...s }));
  const exact = new Set(terms.map((t) => letters(t.term)));
  const dictionary = terms
    .flatMap((t) => t.aliases.filter((a) => a.trim()).map((alias) => ({ alias, term: t.term })))
    .sort((a, b) => b.alias.length - a.alias.length)
    .map(({ alias, term }) => ({
      term,
      pattern: new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegex(alias.trim())}(?![\\p{L}\\p{N}])`,
        'giu',
      ),
    }));
  const fuzzy = terms
    .map((t) => ({ term: t.term, key: letters(t.term), words: t.term.split(/\s+/).length }))
    .filter((t) => t.key.length >= FUZZY_MIN_LETTERS);

  return segments.map((segment) => {
    let text = segment.text;
    for (const { pattern, term } of dictionary) text = text.replace(pattern, term);
    if (fuzzy.length > 0) text = fuzzyCorrect(text, fuzzy, exact);
    return text === segment.text ? { ...segment } : { ...segment, text };
  });
}

function fuzzyCorrect(
  text: string,
  fuzzy: { term: string; key: string; words: number }[],
  exact: Set<string>,
): string {
  // Words with the gaps between them kept, so the line is put back as it was.
  const parts = text.split(/(\s+)/);
  const wordAt: number[] = [];
  parts.forEach((p, i) => {
    if (i % 2 === 0 && p !== '') wordAt.push(i);
  });
  const out = [...parts];
  for (let w = 0; w < wordAt.length; w++) {
    for (const t of fuzzy) {
      const last = w + t.words - 1;
      if (last >= wordAt.length) continue;
      const first = out[wordAt[w]!]!;
      if (!isCapitalised(first)) continue;
      // The words of the window, without their punctuation, which stays where it was.
      const window = [];
      for (let k = w; k <= last; k++) window.push(out[wordAt[k]!]!);
      const lead = /^[^\p{L}\p{N}]*/u.exec(window[0]!)![0];
      const trail = /[^\p{L}\p{N}]*$/u.exec(window[window.length - 1]!)![0];
      const key = letters(window.join(' '));
      if (key.length < FUZZY_MIN_LETTERS || exact.has(key)) continue;
      if (key[0] !== t.key[0]) continue;
      const slips = editDistance(key, t.key);
      if (slips === 0 || slips > allowedSlips(t.key.length)) continue;
      out[wordAt[w]!] = `${lead}${t.term}${trail}`;
      for (let k = w + 1; k <= last; k++) out[wordAt[k]!] = '';
      // The spaces that sat between the words this replaced go too.
      for (let k = w; k < last; k++) out[wordAt[k]! + 1] = '';
      break;
    }
  }
  return out.join('');
}
