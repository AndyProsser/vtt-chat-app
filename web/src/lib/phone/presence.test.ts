import { describe, expect, it } from 'vitest';

import type { Member } from '../../types/phone.js';
import { applyPresenceFrame } from './presence.js';

const members: Member[] = [
  { userId: 'a', displayName: 'Ann', role: 'dm', character: null, online: false },
  {
    userId: 'b',
    displayName: 'Bo',
    role: 'player',
    character: null,
    online: true,
    status: 'offline',
  },
];

describe('applyPresenceFrame', () => {
  it('marks someone connected and disconnected', () => {
    const on = applyPresenceFrame(members, 'presence.update', { userId: 'a', online: true });
    expect(on[0]?.online).toBe(true);
    expect(on[1]).toBe(members[1]);
    expect(
      applyPresenceFrame(on, 'presence.update', { userId: 'a', online: false })[0]?.online,
    ).toBe(false);
  });
  it('applies their own status choice, with the legacy fallback', () => {
    expect(
      applyPresenceFrame(members, 'audio.update', { userId: 'b', inVoice: true, status: 'away' })[1]
        ?.status,
    ).toBe('away');
    expect(
      applyPresenceFrame(members, 'audio.update', { userId: 'b', inVoice: true })[1]?.status,
    ).toBe('online');
    expect(
      applyPresenceFrame(members, 'audio.update', { userId: 'a', inVoice: false })[0]?.status,
    ).toBe('offline');
  });
  it('returns the same list when nothing changes, the person is unknown, or the frame is not presence', () => {
    expect(applyPresenceFrame(members, 'presence.update', { userId: 'b', online: true })).toBe(
      members,
    );
    expect(applyPresenceFrame(members, 'presence.update', { userId: 'zz', online: true })).toBe(
      members,
    );
    expect(applyPresenceFrame(members, 'chat.message', { userId: 'a' })).toBe(members);
    expect(applyPresenceFrame(members, 'presence.update', null)).toBe(members);
  });
});
