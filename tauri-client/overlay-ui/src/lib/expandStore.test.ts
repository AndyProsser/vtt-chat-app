import { describe, expect, it } from 'vitest';

import { useExpandStore } from './expandStore.js';

describe('expandStore', () => {
  it('starts collapsed', () => {
    expect(useExpandStore.getState().expanded).toBe(false);
  });

  it('toggle flips the value', () => {
    useExpandStore.getState().toggle();
    expect(useExpandStore.getState().expanded).toBe(true);

    useExpandStore.getState().toggle();
    expect(useExpandStore.getState().expanded).toBe(false);
  });
});
