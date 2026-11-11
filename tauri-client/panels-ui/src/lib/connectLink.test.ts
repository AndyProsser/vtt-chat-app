import { describe, expect, it } from 'vitest';

import { parseConnectLink } from './connectLink.js';

describe('parseConnectLink', () => {
  it('reads the server and code from a connect link', () => {
    expect(
      parseConnectLink('vtt-chat://connect?server=https%3A%2F%2Fplay.example.com&code=ABCD-2345'),
    ).toEqual({ server: 'https://play.example.com', code: 'ABCD-2345' });
  });

  it('allows a link without a code, and trims whitespace', () => {
    expect(
      parseConnectLink('  vtt-chat://connect?server=http%3A%2F%2Flocalhost%3A3000 \n'),
    ).toEqual({
      server: 'http://localhost:3000',
      code: null,
    });
  });

  it('rejects garbage, a wrong scheme, a wrong host and a missing server', () => {
    expect(parseConnectLink('hello')).toBeNull();
    expect(parseConnectLink('')).toBeNull();
    expect(parseConnectLink('https://connect?server=https%3A%2F%2Fx.com')).toBeNull();
    expect(parseConnectLink('vtt-chat://other?server=https%3A%2F%2Fx.com')).toBeNull();
    expect(parseConnectLink('vtt-chat://connect?code=ABCD-2345')).toBeNull();
  });
});
