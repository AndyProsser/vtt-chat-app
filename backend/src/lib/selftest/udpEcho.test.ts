import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';

import { startUdpEcho, type UdpEcho } from './udpEcho.js';

let echo: UdpEcho | undefined;
afterEach(async () => {
  await echo?.close();
  echo = undefined;
});

const ask = (port: number): Promise<string | undefined> =>
  new Promise((resolve) => {
    const s = createSocket('udp4');
    const t = setTimeout(() => (s.close(), resolve(undefined)), 1000);
    s.once('message', (m) => (clearTimeout(t), s.close(), resolve(m.toString())));
    s.send(Buffer.alloc(0), port, '127.0.0.1');
  });

describe('startUdpEcho', () => {
  it('answers any datagram, even an empty one, so an outside probe can see the port is open', async () => {
    echo = await startUdpEcho({ ports: [0] });
    expect(echo.port).toBeGreaterThan(0);
    expect(await ask(echo.port)).toBe('pong');
  });

  it('skips a port that is taken and uses the next one', async () => {
    const taken = await startUdpEcho({ ports: [0] });
    try {
      echo = await startUdpEcho({ ports: [taken.port, 0] });
      expect(echo.port).not.toBe(taken.port);
    } finally {
      await taken.close();
    }
  });

  it('gives nothing when every port is taken', async () => {
    const taken = await startUdpEcho({ ports: [0] });
    try {
      expect(await startUdpEcho({ ports: [taken.port] })).toBeUndefined();
    } finally {
      await taken.close();
    }
  });

  it('shuts itself down after its lifetime', async () => {
    echo = await startUdpEcho({ ports: [0], lifetimeMs: 50 });
    const port = echo.port;
    await new Promise((r) => setTimeout(r, 150));
    expect(await ask(port)).toBeUndefined();
  });
});
