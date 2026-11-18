import { describe, expect, it } from 'vitest';

import { looksLikeSheetLink, syncedLabel } from './ddbSync.js';

describe('syncedLabel', () => {
  const now = 10 * 86_400_000;
  it('says how long ago, in the largest sensible unit', () => {
    expect(syncedLabel(null, now)).toBe('Not synced yet');
    expect(syncedLabel(now - 20_000, now)).toBe('Synced just now');
    expect(syncedLabel(now - 60_000, now)).toBe('Synced 1 minute ago');
    expect(syncedLabel(now - 5 * 3_600_000, now)).toBe('Synced 5 hours ago');
    expect(syncedLabel(now - 3 * 86_400_000, now)).toBe('Synced 3 days ago');
  });
});

describe('looksLikeSheetLink', () => {
  it('accepts a sheet address or a bare id, and nothing else', () => {
    expect(looksLikeSheetLink('https://www.dndbeyond.com/characters/123')).toBe(true);
    expect(looksLikeSheetLink('https://www.dndbeyond.com/profile/Andy/characters/123')).toBe(true);
    expect(looksLikeSheetLink(' 123 ')).toBe(true);
    expect(looksLikeSheetLink('https://evil.example/characters/123')).toBe(false);
    expect(looksLikeSheetLink('')).toBe(false);
  });
});
