import { describe, expect, it } from 'vitest';

import { isCloudflareIp } from './cloudflare.js';

describe('isCloudflareIp', () => {
  it.each(['104.21.0.5', '172.67.10.1', '188.114.97.3', '162.159.1.1', '2606:4700::6810:1'])(
    '%s is Cloudflare',
    (ip) => expect(isCloudflareIp(ip)).toBe(true),
  );
  it.each([
    '203.0.113.9',
    '8.8.8.8',
    '104.15.0.1',
    '172.63.0.1',
    '2001:db8::1',
    'play.example.com',
  ])('%s is not', (ip) => expect(isCloudflareIp(ip)).toBe(false));
});
