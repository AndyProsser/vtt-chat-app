import { describe, expect, it, vi } from 'vitest';

import { checkSignedIn } from './session.js';

describe('checkSignedIn', () => {
  it('asks the server with the cookie and reports a 200 as signed in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await checkSignedIn(fetchMock)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('treats a refusal or a network failure as signed out', async () => {
    expect(
      await checkSignedIn(vi.fn().mockResolvedValue(new Response('{}', { status: 401 }))),
    ).toBe(false);
    expect(await checkSignedIn(vi.fn().mockRejectedValue(new Error('offline')))).toBe(false);
  });
});
