import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { openTestBackend } from '../store/testing.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const backend = await openTestBackend();
afterAll(() => backend.close());

let server: Server;
let base: string;
let webDir: string;

const config = (dir: string | undefined): any => ({
  port: 0,
  liveKitUrl: 'ws://lk.test',
  liveKitApiKey: 'k',
  liveKitApiSecret: 'testsecret-testsecret-testsecret-1234',
  liveKitApiUrl: 'http://lk.test',
  databaseUrl: undefined,
  valkeyUrl: undefined,
  recordingsDir: undefined,
  mediaDir: undefined,
  webDir: dir,
  clientDownloads: { linux: 'https://dl.test/app.AppImage' },
});

beforeEach(async () => {
  const store = await backend.reset();
  webDir = await mkdtemp(join(tmpdir(), 'web-'));
  await mkdir(join(webDir, 'assets'));
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>join</title>');
  await writeFile(join(webDir, 'assets', 'app.js'), 'console.log(1)');
  const app = createApp({ config: config(webDir), store });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function json(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function makeInvite(): Promise<string> {
  const dm = await json('POST', '/api/auth/register', {
    email: 'dm@example.com',
    displayName: 'DM',
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });
  const campaign = await json(
    'POST',
    '/api/campaigns',
    { name: 'Lost Mine' },
    dm.body.sessionToken,
  );
  const invite = await json(
    'POST',
    `/api/campaigns/${campaign.body.campaign.id}/invites`,
    {},
    dm.body.sessionToken,
  );
  return invite.body.code;
}

describe('the join page backend', () => {
  it('previews a good invite with only the campaign name and the download links', async () => {
    const code = await makeInvite();
    const res = await json('GET', `/api/invites/${code}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      campaignName: 'Lost Mine',
      consentVersion: expect.any(String),
      downloads: { linux: 'https://dl.test/app.AppImage' },
    });
  });

  it('answers a bad code exactly like any other invalid invite', async () => {
    const res = await json('GET', '/api/invites/NOPENOPE12');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invite_invalid');
  });

  it('serves the page at /join and /join/:code, with a locked-down CSP, and its assets', async () => {
    for (const path of ['/join', '/join/ABCD-EFGH']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<title>join</title>');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect((await fetch(`${base}/assets/../index.html`)).status).not.toBe(500);
  });

  it('serves no pages when no web directory is configured', async () => {
    const store = await backend.reset();
    const app = createApp({ config: config(undefined), store });
    const other = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (other.address() as AddressInfo).port;
    expect((await fetch(`http://127.0.0.1:${port}/join`)).status).toBe(404);
    await new Promise<void>((resolve) => other.close(() => resolve()));
  });
});
