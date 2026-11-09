import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { StatusService } from '../status/statusService.js';
import { statusApi } from './statusRoutes.js';

let close: (() => void) | undefined;
afterEach(() => close?.());

async function serve(): Promise<string> {
  const app = express();
  app.use(
    '/api/status',
    statusApi(
      new StatusService({
        probes: [{ name: 'database', run: async () => undefined }],
        onlinePlayers: () => 2,
        activeRecordings: () => 0,
        downloads: {},
      }),
    ),
  );
  const server = app.listen(0);
  close = () => void server.close();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('GET /api/status', () => {
  it('answers without signing in', async () => {
    const base = await serve();
    const response = await fetch(`${base}/api/status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; players: { online: number } };
    expect(body).toMatchObject({ ok: true, players: { online: 2 } });
  });

  it('is rate limited per address', async () => {
    const base = await serve();
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await fetch(`${base}/api/status`)).status;
    expect(last).toBe(429);
  });
});
