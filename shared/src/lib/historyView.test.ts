import { describe, expect, it } from 'vitest';

import {
  moreDetailLabel,
  partitionSummaries,
  splitTaleTitle,
  summaryBlurb,
} from './historyView.js';

describe('splitTaleTitle', () => {
  it('takes the title from a first-line heading and leaves the tale', () => {
    expect(
      splitTaleTitle('# The Weeping Anchor\n\nThey arrived at dusk.\n\nNext time: the Fens.'),
    ).toEqual({
      title: 'The Weeping Anchor',
      body: 'They arrived at dusk.\n\nNext time: the Fens.',
    });
  });
  it('tolerates leading blank lines, a deeper heading, trailing hashes and decoration', () => {
    expect(splitTaleTitle('\n\n## **"The Drowned Choir"** ##\nText').title).toBe(
      'The Drowned Choir',
    );
  });
  it('has no title when the tale starts with prose, or the "title" is a paragraph', () => {
    expect(splitTaleTitle('They arrived at dusk.')).toEqual({
      title: null,
      body: 'They arrived at dusk.',
    });
    const long = `# ${'word '.repeat(30)}`;
    expect(splitTaleTitle(`${long}\nTale`).title).toBeNull();
    expect(splitTaleTitle('#\nTale').title).toBeNull();
  });
});

describe('partitionSummaries', () => {
  const list = [
    { kind: 'session' },
    { kind: 'chapter', subject: '1' },
    { kind: 'chapter', subject: '2' },
    { kind: 'character', subject: 'Kestrel' },
    { kind: 'dm-only' },
    { kind: 'notes' },
    { kind: 'something-new' },
  ];
  it('keeps the tale and the brief, folds chapters and heroes, sets the notes apart', () => {
    const p = partitionSummaries(list);
    expect(p.main.map((s) => s.kind)).toEqual(['session', 'dm-only', 'something-new']);
    expect(p.more).toHaveLength(3);
    expect(p.notes).toHaveLength(1);
  });
});

describe('the blurb and the fold label', () => {
  it('says what a session holds', () => {
    expect(summaryBlurb(['session', 'chapter', 'chapter', 'character'])).toBe(
      'Tale ready · 2 chapters · 1 hero',
    );
    expect(summaryBlurb([])).toBe('');
    expect(summaryBlurb(['chapter'])).toBe('1 chapter');
  });
  it('labels the fold by what is folded', () => {
    expect(moreDetailLabel([{ kind: 'chapter' }, { kind: 'chapter' }, { kind: 'character' }])).toBe(
      'More detail (2 chapters · 1 hero)',
    );
    expect(moreDetailLabel([])).toBe('More detail');
  });
});
