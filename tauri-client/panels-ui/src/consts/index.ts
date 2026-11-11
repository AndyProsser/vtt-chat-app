export const SYNC_EVENT = 'sync:event';
export const ACCOUNT_ERROR_EVENT = 'account:error';
/** Chat kept in a panel; older lines are history, fetched on demand, not held in memory. */
export const CHAT_LIMIT = 300;
export const PANEL_NAMES = [
  'main',
  'settings',
  'handouts',
  'history',
  'inventory',
  'handout',
] as const;
export type PanelName = (typeof PANEL_NAMES)[number];
/** How often a waiting device sign-in asks the server whether the browser approved it. */
export const DEVICE_POLL_INTERVAL_MS = 2000;
/** The server keeps a request 5 minutes; stop 5 s early, by the client's own clock (skew-proof). */
export const DEVICE_REQUEST_TTL_MS = 5 * 60_000 - 5000;
