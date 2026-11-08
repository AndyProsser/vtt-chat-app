import { describe, expect, it } from 'vitest';

import { updateMessage, type UpdateInfo } from './updateInfo.js';

const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({
  version: '0.3.0',
  current: '0.2.0',
  notes: null,
  ...over,
});

describe('updateMessage', () => {
  it('names the new and current versions', () => {
    expect(updateMessage(info())).toBe('Version 0.3.0 is ready (you have 0.2.0).');
  });
  it('adds the first line of the release notes when there are some', () => {
    expect(updateMessage(info({ notes: 'Faster rail.\nMore fixes.' }))).toBe(
      'Version 0.3.0 is ready (you have 0.2.0): Faster rail.',
    );
  });
  it('ignores blank notes', () => {
    expect(updateMessage(info({ notes: '   \n' }))).toBe(
      'Version 0.3.0 is ready (you have 0.2.0).',
    );
  });
});
