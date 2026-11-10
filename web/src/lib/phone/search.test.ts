import { describe, expect, it } from 'vitest';

import { hitLabel, snippetParts } from './search.js';

describe('snippetParts', () => {
  it('splits a snippet at the marked words', () => {
    expect(snippetParts('the <mark>dragon</mark> sleeps')).toEqual([
      { text: 'the ', mark: false },
      { text: 'dragon', mark: true },
      { text: ' sleeps', mark: false },
    ]);
  });
  it('turns the escaped characters back into text, and never into markup', () => {
    expect(snippetParts('a &lt;b&gt; &amp; <mark>c&#39;s</mark> &quot;d&quot;')).toEqual([
      { text: 'a <b> & ', mark: false },
      { text: "c's", mark: true },
      { text: ' "d"', mark: false },
    ]);
  });
  it('returns plain text as one unmarked part, and nothing for an empty snippet', () => {
    expect(snippetParts('just words')).toEqual([{ text: 'just words', mark: false }]);
    expect(snippetParts('')).toEqual([]);
  });
});

describe('hitLabel', () => {
  it('says where a hit came from', () => {
    expect(hitLabel({ source: 'transcript', speakerName: 'Ann', atMs: 65_000 })).toBe(
      'Ann at 1:05',
    );
    expect(hitLabel({ source: 'chat', speakerName: 'Bo', atMs: 5_000 })).toBe('Bo typed at 0:05');
    expect(hitLabel({ source: 'summary', kind: 'session' })).toBe('Summary: session');
    expect(hitLabel({ source: 'transcript' })).toBe('Spoken');
  });
});
