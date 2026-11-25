import { describe, expect, it } from 'vitest';

import { noteHeadings } from './gmNotes.js';

describe('noteHeadings', () => {
  it('lists the headings of the page, with their level, in order', () => {
    expect(noteHeadings('# Notes\ntext\n## Secrets\n### Gary\n')).toEqual([
      { level: 1, text: 'Notes' },
      { level: 2, text: 'Secrets' },
      { level: 3, text: 'Gary' },
    ]);
  });

  it('reads a heading the way it is drawn: no closing hashes or emphasis marks', () => {
    expect(noteHeadings('## **The Weeping** Anchor ##')).toEqual([
      { level: 2, text: 'The Weeping Anchor' },
    ]);
  });

  it('is not fooled by a hashtag, a comment in a code fence, or too many hashes', () => {
    expect(noteHeadings('#hashtag\n```sh\n# a comment\n```\n####### seven\n')).toEqual([]);
  });

  it('keeps a heading after a code fence closes', () => {
    expect(noteHeadings('```\n# no\n```\n## Yes')).toEqual([{ level: 2, text: 'Yes' }]);
  });

  it('has none for an empty page', () => {
    expect(noteHeadings('')).toEqual([]);
  });
});
