import { describe, expect, it } from 'vitest';

import { hasNotes, updateMessage, type UpdateInfo } from './updateInfo.js';

const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
  version: '0.3.0',
  current: '0.2.0',
  notes: null,
  ...over,
});

describe('updateMessage', () => {
  it('names the new and current versions', () => {
    expect(updateMessage(info())).toBe('Version 0.3.0 is available (you have 0.2.0).');
  });
  it('stays one short line however long the release notes are', () => {
    expect(updateMessage(info({ notes: 'Faster rail.\nMore fixes.' }))).toBe(
      'Version 0.3.0 is available (you have 0.2.0).',
    );
  });
});

describe('hasNotes', () => {
  it('is true only when there is something to read', () => {
    expect(hasNotes(info({ notes: 'Faster rail.' }))).toBe(true);
    expect(hasNotes(info({ notes: '   \n' }))).toBe(false);
    expect(hasNotes(info())).toBe(false);
  });
});
