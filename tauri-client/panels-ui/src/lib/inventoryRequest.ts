import type { LootFilter } from '@vtt-chat-app/shared';

/**
 * `/take` and `/stash` open the inventory on a tab. The panel is another window with no channel from the chat, so the request is
 * left in storage (shared by every window of the app) for the panel to read, whether it was already open or is just opening.
 */
const KEY = 'vtt.inventory.tab';

export function requestInventoryTab(tab: LootFilter): void {
  try {
    localStorage.setItem(KEY, `${tab}:${Date.now()}`);
  } catch {
    /* storage unavailable: the inventory opens on its own default */
  }
}

/** The tab asked for, if a request is waiting and recent; it is used up by being read. */
export function takeInventoryTabRequest(now = Date.now()): LootFilter | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    localStorage.removeItem(KEY);
    const [tab, at] = raw.split(':');
    return now - Number(at) < 15_000 ? (tab as LootFilter) : undefined;
  } catch {
    return undefined;
  }
}

/** Calls `onRequest` for a request waiting now, and for each one made while the panel is open. */
export function watchInventoryTabRequests(onRequest: (tab: LootFilter) => void): () => void {
  const check = () => {
    const tab = takeInventoryTabRequest();
    if (tab) onRequest(tab);
  };
  check();
  const listener = (e: StorageEvent) => {
    if (e.key === KEY && e.newValue) check();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
