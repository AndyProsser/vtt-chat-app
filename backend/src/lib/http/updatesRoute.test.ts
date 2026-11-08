import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import type { BackendConfig } from '../config.js';
import { openTestBackend } from '../store/testing.js';

const backend = await openTestBackend();

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

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function serve(updatesDir?: string): Promise<string> {
  const store = await backend.reset();
  const app = createApp({ config: { ...CONFIG, ...(updatesDir ? { updatesDir } : {}) }, store });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe('client updates (/updates)', () => {
  it('serves latest.json and artifacts from UPDATES_DIR, never cached', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'updates-'));
    writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ version: '9.9.9' }));
    mkdirSync(path.join(dir, 'linux'));
    writeFileSync(path.join(dir, 'linux', 'app.AppImage.tar.gz'), 'bytes');
    const base = await serve(dir);

    const latest = await fetch(`${base}/updates/latest.json`);
    expect(latest.status).toBe(200);
    expect(await latest.json()).toEqual({ version: '9.9.9' });
    expect(latest.headers.get('cache-control')).toContain('no-cache');
    expect(await (await fetch(`${base}/updates/linux/app.AppImage.tar.gz`)).text()).toBe('bytes');
  });

  it('is off without UPDATES_DIR, and does not list directories or escape them', async () => {
    expect((await fetch(`${await serve()}/updates/latest.json`)).status).toBe(404);
    await afterEachClose();
    const dir = mkdtempSync(path.join(tmpdir(), 'updates-'));
    writeFileSync(path.join(dir, 'latest.json'), '{}');
    const base = await serve(dir);
    expect((await fetch(`${base}/updates/`)).status).toBe(404);
    expect((await fetch(`${base}/updates/..%2f..%2fetc%2fpasswd`)).status).toBe(404);
  });
});

async function afterEachClose(): Promise<void> {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
}
