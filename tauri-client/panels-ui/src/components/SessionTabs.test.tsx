import { Theme } from '@radix-ui/themes';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SummaryView } from '../lib/history.js';
import { SessionTabs } from './SessionTabs.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const s = (kind: string, text: string, subject?: string): SummaryView =>
  ({
    kind,
    text,
    subject: subject ?? null,
    visibility: kind === 'dm-only' || kind === 'notes' ? 'dm' : 'members',
    createdAt: 0,
  }) satisfies SummaryView;

const ALL = [
  s('session', '# The Weeping Anchor\n\nThey arrived at dusk.'),
  s('character', 'Kestrel picked the lock.', 'Kestrel'),
  s('chapter', 'The crypt, in brief.', '1'),
  s('dm-only', 'Brief: the cultists are bound for the Fens.'),
  s('notes', '- Kestrel opened the door.'),
];

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const show = (ui: React.ReactElement) => act(() => root.render(<Theme>{ui}</Theme>));
// Radix Themes draws each label twice (a hidden copy keeps the tab from changing width when it turns bold).
const tabNames = () =>
  [...host.querySelectorAll('[role="tab"]')].map(
    (t) => t.querySelector('.rt-TabsTriggerInner')?.textContent?.trim() ?? '',
  );
const click = (el: Element | null | undefined) =>
  act(() => el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));
const tab = (name: string) =>
  [...host.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.includes(name));

describe('SessionTabs', () => {
  it('shows one tab for each part of the session, The Tale first and selected', () => {
    show(<SessionTabs summaries={ALL} />);
    expect(tabNames()).toEqual(['The Tale', 'The Heroes', 'The Story', 'The Notes']);
    expect(tab('The Tale')?.getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('They arrived at dusk.');
    expect(host.textContent).not.toContain('Kestrel picked the lock.');
  });

  it('shows the heading the storyteller gave the tale', () => {
    show(<SessionTabs summaries={ALL} />);
    expect(host.textContent).toContain('The Weeping Anchor');
  });

  it('shows another part when its tab is chosen', () => {
    show(<SessionTabs summaries={ALL} />);
    click(tab('The Heroes'));
    expect(host.textContent).toContain('Kestrel picked the lock.');
    expect(host.textContent).not.toContain('They arrived at dusk.');
    click(tab('The Notes'));
    expect(host.textContent).toContain('the cultists are bound for the Fens');
    expect(host.textContent).toContain('Kestrel opened the door.');
  });

  it('has no Notes tab for a player, who is never sent them', () => {
    show(<SessionTabs summaries={ALL.filter((x) => x.kind !== 'dm-only' && x.kind !== 'notes')} />);
    expect(tabNames()).toEqual(['The Tale', 'The Heroes', 'The Story']);
  });

  it('opens on the tab it is told to, and says when the reader changes tab', () => {
    const onTabChange = vi.fn();
    show(<SessionTabs summaries={ALL} initialTab="story" onTabChange={onTabChange} />);
    expect(tab('The Story')?.getAttribute('aria-selected')).toBe('true');
    click(tab('The Heroes'));
    expect(onTabChange).toHaveBeenCalledWith('heroes');
  });

  it('falls back to the first tab if the one it is told to open on is not there', () => {
    show(<SessionTabs summaries={ALL.slice(0, 2)} initialTab="notes" />);
    expect(tab('The Tale')?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows a pop-out button only when it is given something to do', () => {
    show(<SessionTabs summaries={ALL} />);
    expect(host.querySelector('[aria-label="Open in its own window"]')).toBeNull();
    const onPopout = vi.fn();
    show(<SessionTabs summaries={ALL} onPopout={onPopout} />);
    act(() => (host.querySelector('[aria-label="Open in its own window"]') as HTMLElement).click());
    expect(onPopout).toHaveBeenCalledTimes(1);
  });

  it('shows nothing, not an empty tab bar, when there is no summary yet', () => {
    show(<SessionTabs summaries={[]} />);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
  });

  it('adds a Transcript tab at the end for the Game Master, which mounts only when opened', () => {
    const mounted = vi.fn();
    const Transcript = () => {
      mounted();
      return <p>00:01 Fenimore sang.</p>;
    };
    show(<SessionTabs summaries={ALL} transcript={<Transcript />} />);
    expect(tabNames()).toEqual(['The Tale', 'The Heroes', 'The Story', 'The Notes', 'Transcript']);
    expect(mounted).not.toHaveBeenCalled();
    click(tab('Transcript'));
    expect(host.textContent).toContain('Fenimore sang.');
  });

  it('has no Transcript tab unless one is given', () => {
    show(<SessionTabs summaries={ALL} />);
    expect(tabNames()).not.toContain('Transcript');
  });

  it('keeps the pop-out on the last real tab when the Transcript is open', () => {
    const onTabChange = vi.fn();
    show(<SessionTabs summaries={ALL} onTabChange={onTabChange} transcript={<p>x</p>} />);
    click(tab('Transcript'));
    expect(onTabChange).not.toHaveBeenCalled();
  });
});
