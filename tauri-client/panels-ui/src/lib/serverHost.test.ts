import { describe, expect, it } from 'vitest';

import { serverHost } from './serverHost.js';

describe('serverHost', () => {
  it('shows the host with its port, with or without a scheme', () => {
    expect(serverHost('play.example.com')).toBe('play.example.com');
    expect(serverHost('http://localhost:3000/')).toBe('localhost:3000');
    expect(serverHost(' https://a.example.com/x ')).toBe('a.example.com');
  });
  it('is null for empty or unusable input', () => {
    expect(serverHost('')).toBeNull();
    expect(serverHost('http://')).toBeNull();
  });
});
