import { afterEach, describe, expect, it } from 'vitest';

import { requestInventoryTab, takeInventoryTabRequest } from './inventoryRequest.js';

afterEach(() => localStorage.clear());

describe('inventory tab requests', () => {
  it('hands the tab asked for to the panel once', () => {
    requestInventoryTab('available');
    expect(takeInventoryTabRequest()).toBe('available');
    expect(takeInventoryTabRequest()).toBeUndefined();
  });
  it('ignores a request that went stale before the panel opened', () => {
    requestInventoryTab('available');
    expect(takeInventoryTabRequest(Date.now() + 60_000)).toBeUndefined();
  });
  it('has nothing when nothing was asked', () => {
    expect(takeInventoryTabRequest()).toBeUndefined();
  });
});
