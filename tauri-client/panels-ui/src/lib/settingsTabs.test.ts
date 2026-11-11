import { describe, expect, it } from 'vitest';

import { normalizeSettingsTab, SETTINGS_TABS } from './settingsTabs.js';

describe('settings tabs', () => {
  it('lists Profile, Campaign, Sessions, Audio, Notifications in order', () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual([
      'profile',
      'campaign',
      'sessions',
      'audio',
      'notifications',
    ]);
  });
  it('keeps current ids', () => {
    for (const t of SETTINGS_TABS) expect(normalizeSettingsTab(t.id)).toBe(t.id);
  });
  it('maps the old general tab to audio', () => {
    expect(normalizeSettingsTab('general')).toBe('audio');
  });
  it('falls back to profile for unknown or missing ids', () => {
    expect(normalizeSettingsTab('nope')).toBe('profile');
    expect(normalizeSettingsTab(undefined)).toBe('profile');
    expect(normalizeSettingsTab(null)).toBe('profile');
    expect(normalizeSettingsTab('')).toBe('profile');
  });
});
