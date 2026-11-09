export const SYNC_EVENT = 'sync:event';
export const ACCOUNT_ERROR_EVENT = 'account:error';
/** Chat kept in a panel; older lines are history, fetched on demand, not held in memory. */
export const CHAT_LIMIT = 300;
export const PANEL_NAMES = ['main', 'settings', 'handouts', 'history', 'inventory'] as const;
export type PanelName = (typeof PANEL_NAMES)[number];
