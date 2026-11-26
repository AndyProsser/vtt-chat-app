import { Theme } from '@radix-ui/themes';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Every secondary window renders without throwing. A type check cannot see a `const` read before its line (it
 * blanked the session history window in 0.5.3 to 0.5.4), and nothing else here drew a component, so this draws each
 * one against a fake Rust side (the two Tauri packages are mocked; the replies are just enough to show real rows).
 */
const campaigns = [
  { id: 'c1', name: 'Test table', role: 'dm', description: '', allowJoin: true, bard: 'tavern' },
];
const status = {
  signedIn: true,
  server: 'https://example.test',
  campaignId: 'c1',
  userId: 'u1',
  displayName: 'Andy',
  campaigns,
};
const snapshot = {
  t: 'snapshot',
  d: {
    members: [
      {
        userId: 'u1',
        displayName: 'Andy',
        role: 'dm',
        character: null,
        online: true,
        inVoice: false,
        muted: true,
        status: 'online',
      },
    ],
  },
};

function reply(command: string, args: { path?: string } | undefined): unknown {
  switch (command) {
    case 'account_status':
      return status;
    case 'panel_hydrate':
      return { snapshot, events: [] };
    case 'campaign_api': {
      const path = args?.path ?? '';
      if (path === 'recordings')
        return {
          recordings: [
            {
              id: 'r1',
              startedAt: 1_700_000_000_000,
              stoppedAt: 1_700_003_600_000,
              status: 'processed',
              summaries: ['session', 'dm-only'],
            },
          ],
        };
      if (path === 'loot') return { loot: [] };
      if (path === 'handouts') return { handouts: [] };
      if (path === 'characters') return { characters: [] };
      if (path === 'gm/notes')
        return { body: '# Plot\n\ntext', updatedAt: 1, files: [], maxFileBytes: 1024 };
      if (path === 'gm/glossary') return { terms: [] };
      return {};
    }
    default:
      return null;
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { path?: string }) => reply(command, args)),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(globalThis, { ResizeObserver: Observer, IntersectionObserver: Observer });
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const mounted: HTMLElement[] = [];
afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
});

async function draw(element: ReactElement): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Theme>{element}</Theme>);
  });
  // let the fake replies land and the panel settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  const text = host.textContent ?? '';
  await act(async () => root.unmount());
  return text;
}

describe('secondary windows draw', () => {
  it('the session history shows the recorded session', async () => {
    const { HistoryPanel } = await import('./HistoryPanel.js');
    expect((await draw(<HistoryPanel />)).length).toBeGreaterThan(0);
  });
  it('the party inventory', async () => {
    const { LootPanel } = await import('./LootPanel.js');
    expect(await draw(<LootPanel />)).toMatch(/inventory/i);
  });
  it('the handouts', async () => {
    const { HandoutsPanel } = await import('./HandoutsPanel.js');
    expect((await draw(<HandoutsPanel />)).length).toBeGreaterThan(0);
  });
  it('the GM notes and glossary', async () => {
    const { GmNotesPanel } = await import('./notes/GmNotesPanel.js');
    expect(await draw(<GmNotesPanel />)).toMatch(/Notes/);
  });
  it('the settings', async () => {
    const { SettingsContent } = await import('./SettingsWindow.js');
    expect((await draw(<SettingsContent />)).length).toBeGreaterThan(0);
  });
});

/** Renders and keeps the host mounted (cleaned up by the same `afterEach` as `draw`), for tests
 *  that click something after the panel settles. */
async function drawKept(element: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Theme>{element}</Theme>);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return host;
}

function click(host: HTMLElement, label: string): Promise<void> {
  return act(async () => {
    host
      .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('the new-item forms hide behind the panel\'s Add button', () => {
  // Radix's Popover.Content portals into document.body, not under the trigger's own host element.
  it('Handouts: the new-handout form is closed, then opens on Add, as the DM', async () => {
    const { HandoutsPanel } = await import('./HandoutsPanel.js');
    const host = await drawKept(<HandoutsPanel />);
    expect(document.querySelector('[aria-label="New handout"]')).toBeNull();
    await click(host, 'Add a handout');
    expect(document.querySelector('[aria-label="New handout"]')).not.toBeNull();
  });

  it('Party inventory: the loot bench is closed, then opens on Add, as the DM', async () => {
    const { LootPanel } = await import('./LootPanel.js');
    const host = await drawKept(<LootPanel />);
    expect(document.querySelector('[aria-label="Loot bench"]')).toBeNull();
    await click(host, 'Add loot');
    expect(document.querySelector('[aria-label="Loot bench"]')).not.toBeNull();
  });
});
