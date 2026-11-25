import { describe, expect, it } from 'vitest';

import { historyTabs, splitTaleTitle, summaryBlurb } from './historyView.js';

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

describe('the blurb', () => {
  it('says what a session holds', () => {
    expect(summaryBlurb(['session', 'chapter', 'chapter', 'character'])).toBe(
      'Tale ready · 2 chapters · 1 hero',
    );
    expect(summaryBlurb([])).toBe('');
    expect(summaryBlurb(['chapter'])).toBe('1 chapter');
  });
});

describe('historyTabs', () => {
  const tale = { kind: 'session' };
  const ch1 = { kind: 'chapter', subject: '1' };
  const ch2 = { kind: 'chapter', subject: '2' };
  const hero = { kind: 'character', subject: 'Kestrel' };
  const brief = { kind: 'dm-only' };
  const notes = { kind: 'notes' };

  it('sets a session out as The Tale, The Heroes, The Story and The Notes, in that order', () => {
    const tabs = historyTabs([notes, ch1, hero, tale, brief, ch2]);
    expect(tabs.map((t) => t.label)).toEqual(['The Tale', 'The Heroes', 'The Story', 'The Notes']);
    expect(tabs.map((t) => t.id)).toEqual(['tale', 'heroes', 'story', 'notes']);
  });

  it('puts the tale, the heroes, the chapters and the Game Master’s material under the right tab', () => {
    const byId = Object.fromEntries(
      historyTabs([ch1, ch2, hero, tale, notes, brief]).map((t) => [t.id, t.items]),
    );
    expect(byId.tale).toEqual([tale]);
    expect(byId.heroes).toEqual([hero]);
    expect(byId.story).toEqual([ch1, ch2]);
    expect(byId.notes).toEqual([brief, notes]); // the brief first, then the scribe's notes
  });

  it('leaves out a tab with nothing in it, so a player never sees The Notes', () => {
    expect(historyTabs([tale, hero]).map((t) => t.id)).toEqual(['tale', 'heroes']);
    expect(historyTabs([tale]).map((t) => t.id)).toEqual(['tale']);
    expect(historyTabs([])).toEqual([]);
  });

  it('keeps a kind this build does not know, with the tale, rather than dropping it', () => {
    const odd = { kind: 'something-new' };
    expect(historyTabs([tale, odd])[0]?.items).toEqual([tale, odd]);
  });

  it('keeps each tab’s items in the order they came', () => {
    expect(historyTabs([ch2, ch1]).find((t) => t.id === 'story')?.items).toEqual([ch2, ch1]);
  });
});
