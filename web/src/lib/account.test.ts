import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountSession } from '../types/index.js';
import {
  ago,
  avatarCrop,
  avatarSrc,
  changePassword,
  isEmblem,
  noticeLine,
  orderSessions,
  passwordDoneLine,
  passwordProblem,
  revokeOtherSessions,
  sessionLabel,
  uploadAvatar,
} from './account.js';

afterEach(() => vi.unstubAllGlobals());

const session = (over: Partial<AccountSession>): AccountSession => ({
  id: 'x',
  deviceLabel: 'Phone',
  createdAt: 1,
  lastSeenAt: 1,
  current: false,
  ...over,
});

describe('avatarSrc / isEmblem', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('draws an uploaded picture from this server only', () => {
    expect(avatarSrc(`avatar:${id}`)).toBe(`/api/avatars/${id}`);
  });
  it('does not draw emblems, web addresses or junk', () => {
    expect(avatarSrc('emblem:sword')).toBeUndefined();
    expect(avatarSrc('https://evil.test/a.png')).toBeUndefined();
    expect(avatarSrc('avatar:../../etc')).toBeUndefined();
    expect(avatarSrc(null)).toBeUndefined();
    expect(isEmblem('emblem:sword')).toBe(true);
    expect(isEmblem(`avatar:${id}`)).toBe(false);
  });
});

describe('sessionLabel / orderSessions', () => {
  it('uses a stand-in for an empty label and never alters the text', () => {
    expect(sessionLabel({ deviceLabel: null })).toBe('Unknown device');
    expect(sessionLabel({ deviceLabel: '   ' })).toBe('Unknown device');
    expect(sessionLabel({ deviceLabel: '<b>Pwned</b>' })).toBe('<b>Pwned</b>');
  });
  it('puts this device apart and the others newest-seen first', () => {
    const list = [
      session({ id: 'a', lastSeenAt: 10 }),
      session({ id: 'me', current: true, lastSeenAt: 5 }),
      session({ id: 'b', lastSeenAt: 20 }),
    ];
    const { current, others } = orderSessions(list);
    expect(current?.id).toBe('me');
    expect(others.map((s) => s.id)).toEqual(['b', 'a']);
    expect(orderSessions([]).current).toBeUndefined();
  });
});

describe('ago', () => {
  const now = Date.UTC(2026, 10, 13, 12, 0, 0);
  it('speaks in the largest sensible unit', () => {
    expect(ago(now - 5_000, now)).toBe('just now');
    expect(ago(now - 60_000, now)).toBe('1 minute ago');
    expect(ago(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(ago(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(ago(now - 4 * 86_400_000, now)).toBe('4 days ago');
    expect(ago(now - 90 * 86_400_000, now)).toMatch(/^on \d{4}-\d{2}-\d{2}$/);
  });
  it('treats a clock that runs ahead as just now', () => {
    expect(ago(now + 10_000, now)).toBe('just now');
  });
});

describe('noticeLine', () => {
  it('says what was accepted and when', () => {
    const at = new Date(2026, 10, 5, 12).getTime();
    expect(noticeLine({ consentVersion: '2', consentAt: at })).toBe(
      'You accepted version 2 of the recording notice on 2026-11-05.',
    );
    expect(noticeLine({ consentVersion: '2' })).toBe(
      'You accepted version 2 of the recording notice.',
    );
    expect(noticeLine({ consentVersion: '' })).toMatch(/not accepted/);
  });
});

describe('passwordProblem', () => {
  const ok = {
    hasPassword: true,
    current: 'old password!',
    next: 'a new passphrase',
    confirm: 'a new passphrase',
  };
  it('accepts a good change', () => expect(passwordProblem(ok)).toBeUndefined());
  it('needs the current password only when one is set', () => {
    expect(passwordProblem({ ...ok, current: '' })).toMatch(/current/);
    expect(passwordProblem({ ...ok, hasPassword: false, current: '' })).toBeUndefined();
  });
  it('checks length, match and sameness', () => {
    expect(passwordProblem({ ...ok, next: 'short', confirm: 'short' })).toMatch(/at least 10/);
    expect(passwordProblem({ ...ok, confirm: 'different one!' })).toMatch(/do not match/);
    expect(passwordProblem({ ...ok, current: 'a new passphrase' })).toMatch(/same/);
  });
});

describe('passwordDoneLine', () => {
  it('counts the other devices', () => {
    expect(passwordDoneLine(0, true)).toBe('Password changed.');
    expect(passwordDoneLine(1, false)).toBe('Password set. 1 other device was signed out.');
    expect(passwordDoneLine(3, true)).toBe('Password changed. 3 other devices were signed out.');
  });
});

describe('avatarCrop', () => {
  it('crops the centre square and scales down to 256', () => {
    expect(avatarCrop(1000, 500)).toEqual({ sx: 250, sy: 0, side: 500, out: 256 });
    expect(avatarCrop(300, 900)).toEqual({ sx: 0, sy: 300, side: 300, out: 256 });
  });
  it('never enlarges a small picture', () => {
    expect(avatarCrop(100, 80)).toMatchObject({ side: 80, out: 80 });
  });
});

describe('requests', () => {
  function mockFetch(status: number, body?: unknown) {
    const fn = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(body === undefined ? null : JSON.stringify(body), { status }),
    );
    vi.stubGlobal('fetch', fn);
    return fn;
  }
  it('sends the password change as JSON and returns the count', async () => {
    const fn = mockFetch(200, { revoked: 2 });
    expect(await changePassword({ currentPassword: 'a', newPassword: 'b' })).toEqual({
      revoked: 2,
    });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('/api/auth/password');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ currentPassword: 'a', newPassword: 'b' });
  });
  it('signs out the other devices with a POST', async () => {
    const fn = mockFetch(200, { revoked: 1 });
    expect((await revokeOtherSessions()).revoked).toBe(1);
    expect(fn.mock.calls[0]![0]).toBe('/api/auth/sessions/revoke-others');
  });
  it('uploads raw bytes and surfaces a refusal', async () => {
    const fn = mockFetch(201, { id: 'abc' });
    const blob = new Blob(['x'], { type: 'image/webp' });
    expect(await uploadAvatar(blob)).toBe('abc');
    expect(fn.mock.calls[0]![1]?.body).toBe(blob);
    mockFetch(413, { error: 'too_large', message: 'that picture is too large' });
    await expect(uploadAvatar(blob)).rejects.toMatchObject({
      message: 'that picture is too large',
    });
  });
});
