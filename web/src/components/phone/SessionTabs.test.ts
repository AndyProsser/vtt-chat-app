import { Theme } from '@radix-ui/themes';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SummaryItem } from '../../types/phone.js';
import { SessionTabs } from './SessionTabs.js';

const s = (kind: string, text: string, subject: string | null = null): SummaryItem => ({
  kind,
  text,
  subject,
  visibility: kind === 'dm-only' || kind === 'notes' ? 'dm' : 'members',
  createdAt: 0,
});

const ALL = [
  s('session', '# The Weeping Anchor\n\nThey arrived at dusk.'),
  s('character', 'Kestrel picked the lock.', 'Kestrel'),
  s('chapter', 'The crypt, in brief.', '1'),
  s('dm-only', 'Brief: the cultists are bound for the Fens.'),
  s('notes', '- Kestrel opened the door.'),
];

const render = (summaries: SummaryItem[]) =>
  renderToStaticMarkup(createElement(Theme, null, createElement(SessionTabs, { summaries })));
// Radix Themes draws each label twice (a hidden copy keeps the tab from changing width when it turns bold).
const tabNames = (html: string) =>
  [...html.matchAll(/role="tab"[^>]*>.*?rt-TabsTriggerInner">([^<]*)</g)].map((m) => m[1]);

describe('SessionTabs (phone)', () => {
  it('shows one tab for each part, The Tale first, and The Tale’s words', () => {
    const html = render(ALL);
    expect(tabNames(html)).toEqual(['The Tale', 'The Heroes', 'The Story', 'The Notes']);
    expect(html).toContain('They arrived at dusk.');
    expect(html).toContain('The Weeping Anchor');
  });

  it('has no Notes tab when the server sent none (a player)', () => {
    const html = render(ALL.filter((x) => x.visibility === 'members'));
    expect(tabNames(html)).toEqual(['The Tale', 'The Heroes', 'The Story']);
  });

  it('shows nothing when there is no summary yet', () => {
    expect(render([])).not.toContain('role="tablist"');
  });
});
