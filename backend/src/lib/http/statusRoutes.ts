import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import express, { Router } from 'express';

import type { StatusService } from '../status/statusService.js';
import { RateLimiter } from './rateLimit.js';

/**
 * `GET /api/status`: public and read-only, so a DM can post one link and a player can see whether the
 * server is up. Rate-limited per address because it does real work (it probes the services).
 */
export function statusApi(status: StatusService): Router {
  const router = Router();
  const limiter = new RateLimiter(60, 60_000);
  router.get('/', async (req, res) => {
    if (!limiter.allow(req.ip ?? 'unknown')) {
      res.status(429).json({ error: { code: 'rate_limited', message: 'slow down' } });
      return;
    }
    res.json(await status.snapshot());
  });
  return router;
}

/** The built status page (`status/dist`), at `/status`. Same locked-down policy as the join page. */
export function statusPage(dir: string): Router | undefined {
  const root = resolve(dir);
  const index = resolve(root, 'index.html');
  if (!existsSync(index)) return undefined;
  const router = Router();
  router.use('/status', (_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader('Cache-Control', 'no-cache');
    next();
  });
  router.use('/status', express.static(root, { index: 'index.html', dotfiles: 'ignore' }));
  return router;
}
