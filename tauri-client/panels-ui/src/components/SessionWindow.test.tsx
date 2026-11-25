import { Theme } from '@radix-ui/themes';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const campaignApi = vi.fn();
const sessionConfigureWindow = vi.fn((_title: string) => Promise.resolve());
vi.mock('../lib/tauriBridge.js', () => ({
  campaignApi: (...args: unknown[]) => campaignApi(...args),
  sessionConfigureWindow: (title: string) => sessionConfigureWindow(title),
  accountErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  sessionViewOpen: vi.fn(),
}));

import { SessionWindow } from './SessionWindow.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUMMARIES = [
  {
    kind: 'session',
    subject: null,
    visibility: 'members',
    createdAt: 0,
    text: '# The Weeping Anchor\n\nThey arrived at dusk.',
  },
  {
    kind: 'character',
    subject: 'Kestrel',
    visibility: 'members',
    createdAt: 0,
    text: 'Kestrel picked the lock.',
  },
];

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const open = async (hash: string) => {
  window.location.hash = hash;
  await act(async () => {
    root.render(
      <Theme>
        <SessionWindow />
      </Theme>,
    );
  });
};
beforeEach(() => {
  campaignApi.mockReset();
  sessionConfigureWindow.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SessionWindow', () => {
  it('asks for the session named in its address and shows it on the tab it was opened on', async () => {
    campaignApi.mockResolvedValue({ summaries: SUMMARIES });
    await open('#session/rec-1/heroes');
    expect(campaignApi).toHaveBeenCalledWith('GET', 'recordings/rec-1');
    const selected = host.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toContain('The Heroes');
    expect(host.textContent).toContain('Kestrel picked the lock.');
  });

  it('puts the storyteller’s title for the session in the window’s title bar', async () => {
    campaignApi.mockResolvedValue({ summaries: SUMMARIES });
    await open('#session/rec-1');
    expect(sessionConfigureWindow).toHaveBeenCalledWith('The Weeping Anchor');
  });

  it('says so when the session cannot be read', async () => {
    campaignApi.mockRejectedValue(new Error('No such recording'));
    await open('#session/rec-1');
    expect(host.textContent).toContain('No such recording');
  });

  it('does not ask the server anything for an address that is not a session id', async () => {
    await open('#session/../x');
    expect(campaignApi).not.toHaveBeenCalled();
    expect(host.textContent).toContain('not a session');
  });
});
