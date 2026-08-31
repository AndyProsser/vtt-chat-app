import { beforeEach, describe, expect, it } from 'vitest';

import { useExpandStore } from './expandStore.js';

describe('expandStore', () => {
  // The store is a module-level singleton (one per injected overlay instance, not per test), so
  // without a reset here, "starts collapsed" only passes if it happens to run before the toggle
  // test leaves the store expanded — order-dependent in a way vitest doesn't guarantee.
  beforeEach(() => {
    useExpandStore.setState({ expanded: false });
  });

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
