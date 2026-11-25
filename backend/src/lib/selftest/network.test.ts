import { describe, expect, it } from 'vitest';

import { checkNetwork, type NetworkOptions } from './network.js';

const opts = (over: Partial<NetworkOptions> = {}): NetworkOptions => ({
  webHost: 'play.example.com',
  voiceHost: 'play.example.com',
  resolve: async () => ['203.0.113.9'],
  publicAddress: async () => '203.0.113.9',
  webReachable: true,
  voiceReachable: true,
  ...over,
});
const find = (rows: Awaited<ReturnType<typeof checkNetwork>>, name: RegExp) =>
  rows.find((r) => name.test(r.name));

describe('checkNetwork: an ordinary public address', () => {
  it('says what address this server reaches the internet as, and that DNS points at it', async () => {
    const rows = await checkNetwork(opts());
    expect(find(rows, /public address/i)?.badge).toBe('ok');
    expect(find(rows, /public address/i)?.detail).toContain('203.0.113.9');
    expect(find(rows, /play\.example\.com/)?.badge).toBe('ok');
    expect(rows.some((r) => /CGNAT/i.test(r.name))).toBe(false);
  });
});

describe('checkNetwork: carrier-grade NAT', () => {
  it('fails, and says nothing can reach this server, when the server’s own internet address is in the CGNAT range', async () => {
    const rows = await checkNetwork(
      opts({
        publicAddress: async () => '100.72.14.9',
        webReachable: false,
        voiceReachable: false,
      }),
    );
    const r = find(rows, /CGNAT/i)!;
    expect(r.badge).toBe('fail');
    expect(r.detail).toMatch(/shared|carrier-grade/i);
    expect(r.detail).toMatch(/port forward/i);
    expect(r.detail).toMatch(/public IPv4|public IP address|relay/i);
  });

  it('fails when DNS points at a CGNAT or private address, since nothing outside can reach it', async () => {
    const rows = await checkNetwork(opts({ resolve: async () => ['100.72.14.9'] }));
    expect(find(rows, /play\.example\.com/)?.badge).toBe('fail');
    expect(find(rows, /play\.example\.com/)?.detail).toMatch(/CGNAT|private/i);
    const priv = await checkNetwork(opts({ resolve: async () => ['192.168.1.20'] }));
    expect(find(priv, /play\.example\.com/)?.badge).toBe('fail');
  });

  it('suspects CGNAT, and gives the router test, when nothing outside can reach a public-looking server', async () => {
    const rows = await checkNetwork(opts({ webReachable: false, voiceReachable: false }));
    const r = find(rows, /CGNAT/i)!;
    expect(r.badge).toBe('warn');
    expect(r.detail).toMatch(/router/i);
    expect(r.detail).toMatch(/100\.64/);
    expect(r.detail).toContain('203.0.113.9');
  });

  it('does not raise the CGNAT alarm when the web side is reachable (a closed voice port is a forwarding problem)', async () => {
    const rows = await checkNetwork(opts({ voiceReachable: false }));
    expect(find(rows, /CGNAT/i)).toBeUndefined();
  });
});

describe('checkNetwork: names that do not match', () => {
  it('warns that voice points somewhere else than this server’s internet address', async () => {
    const rows = await checkNetwork(
      opts({
        voiceHost: 'voice.example.com',
        resolve: async (h) => (h === 'voice.example.com' ? ['198.51.100.4'] : ['203.0.113.9']),
      }),
    );
    const r = find(rows, /voice\.example\.com/)!;
    expect(r.badge).toBe('warn');
    expect(r.detail).toContain('198.51.100.4');
    expect(r.detail).toContain('203.0.113.9');
  });

  it('is content that the web name differs (it may sit behind Cloudflare), and says so', async () => {
    const rows = await checkNetwork(opts({ resolve: async () => ['104.21.0.5'] }));
    const r = find(rows, /play\.example\.com/)!;
    expect(r.badge).toBe('ok');
    expect(r.detail).toMatch(/Cloudflare|proxy/i);
  });

  it('warns when a name does not resolve at all', async () => {
    const rows = await checkNetwork(
      opts({
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    );
    expect(find(rows, /play\.example\.com/)?.badge).toBe('fail');
  });
});

describe('checkNetwork: when the public address cannot be learned', () => {
  it('says so and still checks the names, rather than failing', async () => {
    const rows = await checkNetwork(opts({ publicAddress: async () => undefined }));
    expect(find(rows, /public address/i)?.badge).toBe('off');
    expect(find(rows, /play\.example\.com/)?.badge).toBe('ok');
  });
});
