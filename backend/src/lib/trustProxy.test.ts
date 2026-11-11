import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { DEFAULT_TRUST_PROXY, loadConfig, parseTrustProxy } from './config.js';
import { openTestBackend } from './store/testing.js';

describe('parseTrustProxy (TRUST_PROXY)', () => {
  it('is loopback when unset or blank', () => {
    expect(parseTrustProxy(undefined)).toEqual({ value: ['loopback'] });
    expect(parseTrustProxy('  ')).toEqual({ value: ['loopback'] });
    expect(loadConfig({}).trustProxy).toEqual(['loopback']);
  });

  it('takes a comma-separated list of named ranges, addresses and subnets', () => {
    expect(parseTrustProxy('loopback, uniquelocal')).toEqual({
      value: ['loopback', 'uniquelocal'],
    });
    expect(parseTrustProxy('172.16.0.0/12,10.0.0.5, fd00::/8').value).toEqual([
      '172.16.0.0/12',
      '10.0.0.5',
      'fd00::/8',
    ]);
    expect(loadConfig({ TRUST_PROXY: 'loopback, uniquelocal' }).trustProxy).toEqual([
      'loopback',
      'uniquelocal',
    ]);
  });

  it('takes a number of hops', () => {
    expect(parseTrustProxy('1')).toEqual({ value: 1 });
    expect(parseTrustProxy('0')).toEqual({ value: 0 });
  });

  it('falls back to loopback with an error for anything else, never widening trust', () => {
    for (const bad of ['true', 'everything', 'loopback,,', '10.0.0.0/33', '1.5', 'loopback; rm']) {
      const parsed = parseTrustProxy(bad);
      expect(parsed.value, bad).toEqual(DEFAULT_TRUST_PROXY);
      expect(parsed.error, bad).toMatch(/TRUST_PROXY/);
    }
  });
});

describe('the trusted proxy decides the client address', () => {
  const CONFIG = {
    port: 0,
    liveKitUrl: 'ws://livekit.test',
    liveKitApiKey: 'testkey',
    liveKitApiSecret: 'testsecret-testsecret-testsecret-1234',
  };

  async function requestIpFor(trustProxy: ReturnType<typeof parseTrustProxy>['value']) {
    const backend = await openTestBackend();
    const store = await backend.reset();
    const app = createApp({ config: { ...CONFIG, trustProxy }, store });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' },
        body: '{}',
      });
      const { requestId } = (await response.json()) as { requestId: string };
      return (await store.getDeviceRequest(requestId))?.requestIp;
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await backend.close();
    }
  }

  it('uses the forwarded address from a trusted proxy', async () => {
    expect(await requestIpFor(['loopback', 'uniquelocal'])).toBe('203.0.113.9');
  });

  it('ignores the header from a proxy it does not trust', async () => {
    expect(await requestIpFor(['10.0.0.0/8'])).toMatch(/127\.0\.0\.1$/);
  });
});
