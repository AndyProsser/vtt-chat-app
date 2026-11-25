import { describe, expect, it } from 'vitest';

import { campaignBlurb } from './campaignBlurb.js';

describe('campaignBlurb', () => {
  it('is the first line of the description, as plain text', () => {
    expect(campaignBlurb('Fog rolls in off the **harbour**.\n\nMore below.')).toBe(
      'Fog rolls in off the harbour.',
    );
  });

  it('skips blank lines and heading marks', () => {
    expect(campaignBlurb('\n\n# The Saltmarrow Coast\nA drowned bell.')).toBe(
      'The Saltmarrow Coast',
    );
  });

  it('keeps a link’s words and drops its address', () => {
    expect(campaignBlurb('See [the map](https://example.com/map) first')).toBe('See the map first');
  });

  it('strips list and quote marks and emphasis', () => {
    expect(campaignBlurb('- _Tonight_: a heist')).toBe('Tonight: a heist');
    expect(campaignBlurb('> A quiet start')).toBe('A quiet start');
  });

  it('cuts a long line with an ellipsis, on a word', () => {
    const long = 'word '.repeat(40);
    const out = campaignBlurb(long, 60);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it('is empty when there is nothing to say', () => {
    expect(campaignBlurb('')).toBe('');
    expect(campaignBlurb('   \n  ')).toBe('');
  });
});
