import { describe, expect, it } from 'vitest';

import type { AccountStatus } from '../types/index.js';
import { gateState } from './gate.js';

const status = (over: Partial<AccountStatus> = {}): AccountStatus => ({
  signedIn: false,
  server: null,
  campaignId: null,
  userId: null,
  displayName: null,
  campaigns: [],
  ...over,
});

describe('gateState', () => {
  it('waits while the account state is still being read', () => {
    expect(gateState(undefined)).toBe('loading');
  });
  it('asks for sign-in when there is no session', () => {
    expect(gateState(status())).toBe('sign-in');
    expect(gateState(status({ server: 'https://x' }))).toBe('sign-in');
  });
  it('asks which campaign when signed in with several and none chosen', () => {
    expect(
      gateState(
        status({
          signedIn: true,
          campaigns: [
            { id: 'a', name: 'A', role: 'dm' },
            { id: 'b', name: 'B', role: 'player' },
          ],
        }),
      ),
    ).toBe('choose-campaign');
  });
  it('explains there is nothing to join when signed in with no campaigns at all', () => {
    expect(gateState(status({ signedIn: true }))).toBe('no-campaign');
  });
  it('is ready once signed in with a campaign chosen', () => {
    expect(
      gateState(
        status({
          signedIn: true,
          campaignId: 'a',
          campaigns: [{ id: 'a', name: 'A', role: 'dm' }],
        }),
      ),
    ).toBe('ready');
  });
});
