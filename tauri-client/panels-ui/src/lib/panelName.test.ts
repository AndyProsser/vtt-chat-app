import { describe, expect, it } from 'vitest';

import { panelFromHash } from './panelName.js';

describe('panelFromHash', () => {
  it('reads the four window names', () => {
    for (const name of ['main', 'settings', 'handouts', 'inventory']) {
      expect(panelFromHash(`#${name}`)).toBe(name);
    }
  });
  it('shows the main window for an empty or retired or unknown hash', () => {
    expect(panelFromHash('')).toBe('main');
    expect(panelFromHash('#chat')).toBe('main');
    expect(panelFromHash('#../x')).toBe('main');
  });
});
