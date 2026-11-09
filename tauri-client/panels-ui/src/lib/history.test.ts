import { describe, expect, it } from 'vitest';

import { clock, durationLabel, snippetParts, summaryLabel } from './history.js';

describe('durationLabel', () => {
  it('reads naturally across the ranges', () => {
    expect(durationLabel(0, null)).toBe('still going');
    expect(durationLabel(0, 20_000)).toBe('under a minute');
    expect(durationLabel(0, 45 * 60_000)).toBe('45 min');
    expect(durationLabel(0, 125 * 60_000)).toBe('2 h 05 min');
  });
});

describe('clock', () => {
  it('shows minutes and seconds, with hours when needed', () => {
    expect(clock(5_000)).toBe('0:05');
    expect(clock(309_000)).toBe('5:09');
    expect(clock(3_909_000)).toBe('1:05:09');
  });
});

describe('snippetParts', () => {
  it('splits marks from text and decodes entities, never producing markup', () => {
    expect(snippetParts('the <mark>dragon</mark> &amp; the &lt;b&gt; knight')).toEqual([
      { text: 'the ', mark: false },
      { text: 'dragon', mark: true },
      { text: ' & the <b> knight', mark: false },
    ]);
    expect(snippetParts('no hits')).toEqual([{ text: 'no hits', mark: false }]);
  });
});

describe('summaryLabel', () => {
  it('names the kinds and passes unknown ones through', () => {
    expect(summaryLabel('dm-only')).toBe('DM only');
    expect(summaryLabel('odd')).toBe('odd');
  });
});
