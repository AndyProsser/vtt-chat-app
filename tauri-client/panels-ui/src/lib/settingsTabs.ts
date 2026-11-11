/** The Settings tabs, in order. `general` is gone: audio and notifications each have a tab now. */
export const SETTINGS_TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'audio', label: 'Audio' },
  { id: 'notifications', label: 'Notifications' },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

/** Tab ids that were renamed or split; a stored or linked old id lands on its successor. */
const RENAMED: Record<string, SettingsTabId> = { general: 'audio' };

/** Any stored or requested tab id to a real one (old ids mapped, unknown or missing ones to Profile). */
export function normalizeSettingsTab(id: string | null | undefined): SettingsTabId {
  if (!id) return 'profile';
  const mapped = RENAMED[id] ?? id;
  return SETTINGS_TABS.some((t) => t.id === mapped) ? (mapped as SettingsTabId) : 'profile';
}
