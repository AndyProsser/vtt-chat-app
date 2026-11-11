import { describe, expect, it } from 'vitest';

import { connectLink } from './connect.js';

describe('connectLink', () => {
  it('encodes the server and carries the code', () => {
    const link = connectLink('https://vtt.example.com:8443', 'ABCD-2345');
    expect(link).toBe(
      'vtt-chat://connect?server=https%3A%2F%2Fvtt.example.com%3A8443&code=ABCD-2345',
    );
  });

  it('round-trips through URL parsing', () => {
    const url = new URL(connectLink('http://192.168.1.5:3000', 'WXYZ-6789'));
    expect(url.protocol).toBe('vtt-chat:');
    expect(url.searchParams.get('server')).toBe('http://192.168.1.5:3000');
    expect(url.searchParams.get('code')).toBe('WXYZ-6789');
  });

  it('carries a long link token unchanged', () => {
    const token = 'Zm9vYmFyLV9iYXo0NTY3ODkwQUJDREVGR0hJSktMTU4';
    const url = new URL(connectLink('https://vtt.example.com', token));
    expect(url.searchParams.get('code')).toBe(token);
  });
});
