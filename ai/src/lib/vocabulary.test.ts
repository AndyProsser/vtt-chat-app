import { describe, expect, it } from 'vitest';

import {
  buildWhisperPrompt,
  correctSegments,
  editDistance,
  type VocabularyTerm,
} from './vocabulary.js';

const term = (t: string, rank = 0, aliases: string[] = []): VocabularyTerm => ({
  term: t,
  rank,
  aliases,
});
const seg = (text: string) => [{ startMs: 0, endMs: 1000, text }];
const fix = (text: string, terms: VocabularyTerm[]) => correctSegments(seg(text), terms)[0]!.text;

describe('buildWhisperPrompt', () => {
  it('is undefined with no terms', () => expect(buildWhisperPrompt([])).toBeUndefined());

  it('lists the best-ranked terms first, once each', () => {
    const prompt = buildWhisperPrompt([term('Pim', 2), term('Ravenshade', 0), term('pim', 1)]);
    expect(prompt).toBe('Names in this game: Ravenshade, pim.');
  });

  it('stops at the limit and keeps whole terms', () => {
    const prompt = buildWhisperPrompt(
      [term('Alpha', 0), term('Bravo', 1), term('Charlie', 2)],
      'Names in this game: .'.length + 16,
    );
    expect(prompt).toBe('Names in this game: Alpha, Bravo.');
  });
});

describe('editDistance', () => {
  it('counts a swap as one slip', () => expect(editDistance('ravneshade', 'ravenshade')).toBe(1));
  it('counts insertions and substitutions', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('correctSegments', () => {
  it('replaces a known wrong spelling, whole words, any case', () => {
    const terms = [term('Ravenshade', 0, ['raven shade', 'Ravenshaid'])];
    expect(fix('We spoke to raven shade, and Ravenshaid agreed.', terms)).toBe(
      'We spoke to Ravenshade, and Ravenshade agreed.',
    );
  });

  it('does not touch a word that merely contains an alias', () => {
    expect(fix('The Gary-oke night', [term('Gary', 0, ['Gar'])])).toBe('The Gary-oke night');
    expect(fix('A garland', [term('Gary', 0, ['Gar'])])).toBe('A garland');
  });

  it('fixes a capitalised near-miss of a long name and keeps the punctuation', () => {
    expect(fix('"Lord Ravenshaid," said the guard.', [term('Ravenshade')])).toBe(
      '"Lord Ravenshade," said the guard.',
    );
  });

  it('fixes a two-word name by its words together', () => {
    expect(fix('We reached Blackstone Kepe at dawn.', [term('Blackstone Keep')])).toBe(
      'We reached Blackstone Keep at dawn.',
    );
  });

  it('leaves ordinary words, lower case words and short names alone', () => {
    const terms = [term('Ravenshade'), term('Pim'), term('Elara')];
    const line = 'The raven shade fell. Pam said the area was clear. Ravens flew.';
    expect(fix(line, terms)).toBe(line);
  });

  it('leaves a word that is itself a term alone', () => {
    expect(fix('Elaris met Elara.', [term('Elara'), term('Elaris')])).toBe('Elaris met Elara.');
  });

  it('changes only the text, and returns copies', () => {
    const input = [{ startMs: 5, endMs: 9, text: 'Ravenshaid' }];
    const out = correctSegments(input, [term('Ravenshade')]);
    expect(out).toEqual([{ startMs: 5, endMs: 9, text: 'Ravenshade' }]);
    expect(input[0]!.text).toBe('Ravenshaid');
  });
});
