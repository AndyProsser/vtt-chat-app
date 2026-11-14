import { describe, expect, it } from 'vitest';

import { AI_REQUEST_TIMEOUT_MS, longFetch } from './longFetch.js';

describe('longFetch', () => {
  it('waits far longer than Node’s own five-minute limit, and is a drop-in fetch', () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(5 * 60_000);
    expect(typeof longFetch).toBe('function');
  });
});
