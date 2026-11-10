import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import express, { Router } from 'express';

import type { CampaignService } from '../campaigns/campaignService.js';
import type { ClientDownloads } from '../config.js';
import type { RateLimiter } from './rateLimit.js';

export interface JoinRouteDeps {
  campaigns: CampaignService;
  downloads: ClientDownloads;
  /** Slows guessing of invite codes; shared with the join endpoint so both draw on one budget. */
  inviteLimiter: RateLimiter;
}

/**
 * `GET /api/invites/:code` — the public half of the browser join page: is this invite good, which
 * campaign is it for, and where is the app. Deliberately tiny: the campaign name is the only thing a
 * code holder learns before signing up, and the app's own sign-in takes over after that.
 */
export function inviteRoutes({ campaigns, downloads, inviteLimiter }: JoinRouteDeps): Router {
  const router = Router();
  router.get('/:code', async (req, res) => {
    if (!inviteLimiter.allow(`invite:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many attempts; try again later' });
      return;
    }
    const preview = await campaigns.previewInvite(String(req.params.code));
    res.json({ ...preview, downloads });
  });
  return router;
}

/**
 * Serves the built join page (`web/dist`) at `/join/*` and its assets. The page is the only browser
 * UI: first-run account creation and the app download. Everything after install happens in the app.
 * Returns undefined when the directory isn't there, so a backend without the page still starts.
 */
export function webPages(webDir: string): Router | undefined {
  const root = resolve(webDir);
  const index = resolve(root, 'index.html');
  if (!existsSync(index)) return undefined;

  const router = Router();
  router.use((req, res, next) => {
    // Only this origin's own script and styles; the page talks to this server's API and nothing else.
    // The phone app also shows pictures it fetched with its sign-in (blob:) and listens on a WebSocket
    // to the same server (ws:/wss: because browsers differ on whether 'self' covers it).
    const phoneApp = req.path === '/app';
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
        `img-src 'self' data:${phoneApp ? ' blob:' : ''}; ` +
        `${phoneApp ? "connect-src 'self' ws: wss:; " : ''}` +
        "style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    );
    next();
  });
  const phone = resolve(root, 'app.html');
  router.use(
    '/assets',
    express.static(resolve(root, 'assets'), {
      immutable: true,
      maxAge: '1y',
      fallthrough: false,
    }),
  );
  router.get(['/join', '/join/:code'], (_req, res) => {
    res.sendFile(index);
  });
  // The phone app (web/app.html). Hash routes, so this one path is all the server needs to know.
  router.get('/app', (_req, res, next) => {
    if (!existsSync(phone)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(phone);
  });
  return router;
}
