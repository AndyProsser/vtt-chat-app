import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import express, { Router, type RequestHandler } from 'express';

import type { CampaignService } from '../campaigns/campaignService.js';
import { ogMetaTags, siteOgTags } from './ogTags.js';
import type { RateLimiter } from './rateLimit.js';

export interface JoinRouteDeps {
  campaigns: CampaignService;
  /** Slows guessing of invite codes; shared with the join endpoint so both draw on one budget. */
  inviteLimiter: RateLimiter;
}

/**
 * `GET /api/invites/:code` — the public half of the browser join page: is this invite good, which
 * campaign is it for. Deliberately tiny: the campaign name is the only thing a
 * code holder learns before signing up, and the app's own sign-in takes over after that.
 */
export function inviteRoutes({ campaigns, inviteLimiter }: JoinRouteDeps): Router {
  const router = Router();
  router.get('/:code', async (req, res) => {
    if (!inviteLimiter.allow(`invite:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many attempts; try again later' });
      return;
    }
    const preview = await campaigns.previewInvite(String(req.params.code));
    res.json(preview);
  });
  return router;
}

/**
 * Serves the built join page (`web/dist`) at `/` (landing), `/download`, `/join/*` and `/connect`, and its assets. The page is the only browser
 * UI: first-run account creation and the app download. Everything after install happens in the app.
 * Returns undefined when the directory isn't there, so a backend without the page still starts.
 */
/** Paths that belong to something other than the site's pages; an unknown path under one stays a plain 404. */
const NOT_PAGES = /^\/(api|updates|assets|status|ws)(\/|$)/;

/**
 * The last handler: a browser that navigates to an address nothing serves gets the site's own page with a
 * 404 status (the page draws "Page not found" inside the usual frame), not Express's bare text. Anything
 * that is not a browser navigation (an API client, an image, a script) keeps the plain 404.
 */
export function webNotFound(webDir: string, publicUrl?: string): RequestHandler | undefined {
  const index = resolve(webDir, 'index.html');
  if (!existsSync(index)) return undefined;
  const withDefaultCard = withExtraHead(index);
  return (req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || NOT_PAGES.test(req.path)) return next();
    if (!req.header('accept')?.includes('text/html')) return next();
    if (!publicUrl) return void res.status(404).sendFile(index);
    res
      .status(404)
      .type('html')
      .send(withDefaultCard(siteOgTags({ publicUrl, path: req.path })));
  };
}

export interface WebPagesOptions {
  campaigns: CampaignService;
  publicUrl: string | undefined;
  /** Crawlers fetch `/join/<code>` for the link preview; this keeps them from becoming a code-guessing oracle. */
  ogLimiter: RateLimiter;
}

/**
 * `index.html` with a page-specific head spliced in, re-read only when the file changes. The tags replace
 * the page's own `<title>` so there is exactly one.
 */
function withHead(index: string): (tags: string) => string {
  let cached: { mtime: number; html: string } | undefined;
  return (tags) => {
    const mtime = statSync(index).mtimeMs;
    if (!cached || cached.mtime !== mtime) cached = { mtime, html: readFileSync(index, 'utf8') };
    const html = cached.html.replace(/<title>[\s\S]*?<\/title>/i, '');
    return html.includes('</head>') ? html.replace('</head>', `${tags}\n</head>`) : tags + html;
  };
}

/** `index.html` with extra tags added to the head, the page's own `<title>` kept (for pages with a default card). */
function withExtraHead(index: string): (tags: string) => string {
  let cached: { mtime: number; html: string } | undefined;
  return (tags) => {
    const mtime = statSync(index).mtimeMs;
    if (!cached || cached.mtime !== mtime) cached = { mtime, html: readFileSync(index, 'utf8') };
    return cached.html.includes('</head>')
      ? cached.html.replace('</head>', `${tags}\n</head>`)
      : tags + cached.html;
  };
}

export function webPages(webDir: string, options?: WebPagesOptions): Router | undefined {
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
  const tagged = withHead(index);
  const withDefaultCard = withExtraHead(index);
  // A pasted invite link unfurls in a chat app: the page's head carries this invite's Open Graph tags. A bad
  // code, or a crawler over its budget, gets the generic tags and the same page (never a 429 or a 404 that
  // would tell a prober which codes exist).
  if (options) {
    router.get('/join/:code', async (req, res) => {
      let preview = null;
      if (options.ogLimiter.allow(`og:${req.ip}`)) {
        preview = await options.campaigns.previewInvite(String(req.params.code)).catch(() => null);
      }
      res.setHeader('Cache-Control', 'no-store');
      res
        .type('html')
        .send(tagged(ogMetaTags({ preview, publicUrl: options.publicUrl, path: req.path })));
    });
  }
  router.get(
    [
      '/',
      '/join',
      '/join/:code',
      '/connect',
      '/download',
      '/full-app',
      '/account',
      '/email-signin',
      '/reset-password',
    ],
    (req, res) => {
      // Every public page carries the default link card, so any shared link unfurls (not the invite: above).
      if (!options?.publicUrl) return void res.sendFile(index);
      res
        .type('html')
        .send(withDefaultCard(siteOgTags({ publicUrl: options.publicUrl, path: req.path })));
    },
  );
  // The phone app (web/app.html). Hash routes, so this one path is all the server needs to know.
  router.get('/app', (_req, res, next) => {
    if (!existsSync(phone)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(phone);
  });
  // The install manifest and its icons: a fixed list, so nothing else in the folder is reachable.
  const installFiles: Record<string, string> = {
    '/app.webmanifest': 'application/manifest+json',
    '/app-icon-192.png': 'image/png',
    '/app-icon-512.png': 'image/png',
    '/apple-touch-icon.png': 'image/png',
    '/og-banner.jpg': 'image/jpeg',
    '/old-browser.js': 'text/javascript',
    '/old-browser.jpg': 'image/jpeg',
  };
  router.get(Object.keys(installFiles), (req, res, next) => {
    const file = resolve(root, req.path.slice(1));
    if (!existsSync(file)) return next();
    res.type(installFiles[req.path]!);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(file);
  });
  return router;
}
