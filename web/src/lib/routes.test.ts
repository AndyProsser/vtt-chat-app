import { describe, expect, it } from 'vitest';

import { resolveRoute } from './routes.js';

describe('resolveRoute', () => {
  it('knows the real pages, with or without a trailing slash', () => {
    expect(resolveRoute('/')).toBe('landing');
    expect(resolveRoute('')).toBe('landing');
    expect(resolveRoute('/download/')).toBe('download');
    expect(resolveRoute('/full-app')).toBe('full-app');
    expect(resolveRoute('/connect')).toBe('connect');
    expect(resolveRoute('/account/')).toBe('account');
  });

  it('treats /join and /join/<code> as the join page', () => {
    expect(resolveRoute('/join')).toBe('join');
    expect(resolveRoute('/join/ABCD-1234')).toBe('join');
  });

  it('shows not-found for everything else, including look-alikes', () => {
    expect(resolveRoute('/nope')).toBe('not-found');
    expect(resolveRoute('/joined')).toBe('not-found');
    expect(resolveRoute('/download/extra')).toBe('not-found');
    expect(resolveRoute('/account/x')).toBe('not-found');
    expect(resolveRoute('/wp-login.php')).toBe('not-found');
  });
});
