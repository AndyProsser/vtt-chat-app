/* eslint-disable @typescript-eslint/no-explicit-any -- tests inspect loosely-typed JSON bodies */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { MemoryMediaStorage } from '../media/mediaStorage.js';
import { openTestBackend } from '../store/testing.js';

const backend = await openTestBackend();
afterAll(() => backend.close());

const CONFIG: BackendConfig = {
  port: 0,
  liveKitUrl: 'ws://lk.test',
  liveKitApiKey: 'k',
  liveKitApiSecret: 's',
  databaseUrl: undefined,
  valkeyUrl: undefined,
  recordingsDir: undefined,
  mediaDir: undefined,
  liveKitApiUrl: 'http://lk.test',
  webDir: undefined,
  clientDownloads: {},
};
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

let server: Server;
let base: string;
let media: MemoryMediaStorage;
let token: string;

async function call(method: string, path: string, tok?: string, raw?: Buffer) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    ...(raw ? { body: new Uint8Array(raw) } : {}),
  });
  const buf = Buffer.from(await response.arrayBuffer());
  const text = buf.toString('utf8');
  return {
    status: response.status,
    headers: response.headers,
    buf,
    body: text.startsWith('{') ? JSON.parse(text) : undefined,
  };
}

beforeEach(async () => {
  const store = await backend.reset();
  media = new MemoryMediaStorage();
  const app = createApp({ config: CONFIG, store, media });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'a@example.com',
      displayName: 'A',
      password: 'correct horse battery',
      acceptedConsentVersion: '1',
    }),
  });
  token = ((await reg.json()) as any).sessionToken;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('avatars', () => {
  it('stores a picture and serves it back to a signed-in person, as inert data', async () => {
    const up = await call('POST', '/api/avatars/upload', token, PNG);
    expect(up.status).toBe(201);
    const id = up.body.id as string;
    const got = await call('GET', `/api/avatars/${id}`, token);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(got.buf.equals(PNG)).toBe(true);
  });

  it('needs a signed-in person for both', async () => {
    expect((await call('POST', '/api/avatars/upload', undefined, PNG)).status).toBe(401);
    const id = (await call('POST', '/api/avatars/upload', token, PNG)).body.id;
    expect((await call('GET', `/api/avatars/${id}`)).status).toBe(401);
  });

  it('refuses anything that is not a small picture', async () => {
    const html = Buffer.from('<script>alert(1)</script>');
    expect((await call('POST', '/api/avatars/upload', token, html)).status).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(300 * 1024)]);
    expect((await call('POST', '/api/avatars/upload', token, big)).status).toBe(413);
    expect((await call('POST', '/api/avatars/upload', token, Buffer.alloc(0))).status).toBe(400);
  });

  it('does not serve ids that were never uploaded or that try to escape', async () => {
    expect(
      (await call('GET', '/api/avatars/00000000-0000-0000-0000-000000000000', token)).status,
    ).toBe(404);
    expect((await call('GET', '/api/avatars/..%2F..%2Fetc', token)).status).toBe(404);
  });
});
