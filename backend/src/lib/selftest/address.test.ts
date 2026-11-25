import { describe, expect, it } from 'vitest';

import { classifyIp } from './address.js';

describe('classifyIp', () => {
  it.each([
    ['203.0.113.9', 'public'],
    ['8.8.8.8', 'public'],
    ['100.63.255.255', 'public'], // just below the carrier-grade range
    ['100.128.0.1', 'public'], // just above it
  ])('%s is %s', (ip, kind) => expect(classifyIp(ip)).toBe(kind));

  it.each(['100.64.0.1', '100.100.100.100', '100.127.255.254'])(
    '%s is in the range ISPs use for carrier-grade NAT',
    (ip) => expect(classifyIp(ip)).toBe('cgnat'),
  );

  it.each(['10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.20'])('%s is private', (ip) =>
    expect(classifyIp(ip)).toBe('private'),
  );

  it('knows loopback, link-local and unspecified addresses', () => {
    expect(classifyIp('127.0.0.1')).toBe('loopback');
    expect(classifyIp('169.254.10.1')).toBe('private');
    expect(classifyIp('0.0.0.0')).toBe('private');
  });

  it('does not mistake 172.15 or 172.32 for private', () => {
    expect(classifyIp('172.15.0.1')).toBe('public');
    expect(classifyIp('172.32.0.1')).toBe('public');
  });

  it('classifies IPv6 loopback and unique-local addresses, and leaves a global one public', () => {
    expect(classifyIp('::1')).toBe('loopback');
    expect(classifyIp('fd12:3456::1')).toBe('private');
    expect(classifyIp('fe80::1')).toBe('private');
    expect(classifyIp('2001:db8::1')).toBe('public');
  });

  it('has no opinion on something that is not an address', () => {
    expect(classifyIp('play.example.com')).toBeUndefined();
    expect(classifyIp('')).toBeUndefined();
  });
});
