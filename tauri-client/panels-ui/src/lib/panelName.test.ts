import { describe, expect, it } from 'vitest';

import { handoutIdFromHash, panelFromHash } from './panelName.js';

describe('panelFromHash', () => {
  it('reads the window names', () => {
    for (const name of ['main', 'settings', 'handouts', 'history', 'inventory']) {
      expect(panelFromHash(`#${name}`)).toBe(name);
    }
  });
  it('reads a handout viewer window and its id, and rejects an id that is not plain', () => {
    expect(panelFromHash('#handout/abc-123')).toBe('handout');
    expect(handoutIdFromHash('#handout/abc-123')).toBe('abc-123');
    expect(handoutIdFromHash('#handout/../x')).toBeUndefined();
    expect(handoutIdFromHash('#handouts')).toBeUndefined();
  });
  it('shows the main window for an empty or retired or unknown hash', () => {
    expect(panelFromHash('')).toBe('main');
    expect(panelFromHash('#chat')).toBe('main');
    expect(panelFromHash('#../x')).toBe('main');
  });
});
