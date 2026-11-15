import { describe, expect, it, vi } from 'vitest';

import { takeTokenFromHash } from './fragment.js';

describe('takeTokenFromHash', () => {
  it('returns the token and clears the hash from the address', () => {
    const replaceState = vi.fn();
    const token = takeTokenFromHash(
      { hash: '#token=abc%20d', pathname: '/email-signin', search: '' },
      { replaceState },
    );
    expect(token).toBe('abc d');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/email-signin');
  });

  it('returns nothing when there is no token or it is absurdly long', () => {
    const history = { replaceState: vi.fn() };
    expect(takeTokenFromHash({ hash: '', pathname: '/x', search: '' }, history)).toBeUndefined();
    expect(
      takeTokenFromHash({ hash: `#token=${'a'.repeat(300)}`, pathname: '/x', search: '' }, history),
    ).toBeUndefined();
  });
});
