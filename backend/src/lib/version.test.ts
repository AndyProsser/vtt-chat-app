import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '@vtt-chat-app/shared';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { protocolGate, serverVersion, versionRoutes } from './version.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

async function call(headers: Record<string, string>, path = '/api/ping') {
  const app = express();
  app.use('/api/version', versionRoutes('0.3.2')); // before the gate: a refused client can still read it
  app.use('/api', protocolGate('0.3.2'));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  await new Promise<void>((r) => (server = app.listen(0, '127.0.0.1', r)));
  const port = (server!.address() as AddressInfo).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('protocol handshake', () => {
  it('serves a client on the same protocol', async () => {
    expect((await call({ [PROTOCOL_HEADER]: String(PROTOCOL_VERSION) })).status).toBe(200);
  });

  it('serves callers that send no protocol (browser pages, the admin CLI)', async () => {
    expect((await call({})).status).toBe(200);
  });

  it('refuses a different protocol with 426 and says which build the server is', async () => {
    const { status, body } = await call({ [PROTOCOL_HEADER]: String(PROTOCOL_VERSION + 1) });
    expect(status).toBe(426);
    expect(body).toMatchObject({
      error: 'update_required',
      serverVersion: '0.3.2',
      serverProtocol: PROTOCOL_VERSION,
    });
  });

  it('refuses a malformed protocol header rather than guessing', async () => {
    expect((await call({ [PROTOCOL_HEADER]: 'abc' })).status).toBe(426);
  });

  it('reports its version and protocol even to a client that would be refused', async () => {
    const { status, body } = await call({ [PROTOCOL_HEADER]: '0' }, '/api/version');
    expect(status).toBe(200);
    expect(body).toEqual({ version: '0.3.2', protocol: PROTOCOL_VERSION });
  });
});

describe('serverVersion', () => {
  it('prefers the baked-in VTT_VERSION', () => {
    expect(serverVersion({ VTT_VERSION: '9.9.9' })).toBe('9.9.9');
  });
  it('falls back to the package version', () => {
    expect(serverVersion({})).toMatch(/^\d+\.\d+\.\d+/);
  });
});
