import { Router, type Response } from 'express';

import { MAGIC_LINK_TTL_MINUTES } from '../../consts/index.js';
import type { AccountService } from '../auth/accountService.js';
import { OidcError, type OidcClient } from '../auth/oidc.js';
import { RateLimiter } from './rateLimit.js';

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: Response, status: number, title: string, body: string): void {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 1rem}
code{display:block;font:600 1.4rem ui-monospace,monospace;padding:.8rem 1rem;border:1px solid #8884;border-radius:.6rem;word-break:break-all;user-select:all}
</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
}

/**
 * Optional single sign-on, mounted at `/api/auth/oidc`. The player opens `/` in a browser, signs in at
 * the operator's identity provider, and lands on `/callback` showing a one-time code to paste into the
 * app. That reuses the emailed-code sign-in, so the app needs no browser redirect handling of its own.
 * Only people who already have an account (from an invite) can get a code: SSO does not create accounts.
 */
export function oidcRoutes(oidc: OidcClient, accounts: AccountService): Router {
  const router = Router();
  const limiter = new RateLimiter(20, 15 * 60_000);

  router.get('/', async (req, res) => {
    if (!limiter.allow(`oidc:${req.ip}`)) {
      page(res, 429, 'Too many attempts', '<p>Wait a few minutes and try again.</p>');
      return;
    }
    try {
      res.redirect(302, await oidc.begin());
    } catch {
      page(
        res,
        502,
        'Single sign-on is unavailable',
        '<p>The identity provider could not be reached.</p>',
      );
    }
  });

  router.get('/callback', async (req, res) => {
    if (!limiter.allow(`oidc:${req.ip}`)) {
      page(res, 429, 'Too many attempts', '<p>Wait a few minutes and try again.</p>');
      return;
    }
    const { state, code } = req.query;
    if (typeof state !== 'string' || typeof code !== 'string') {
      page(res, 400, 'Sign-in did not finish', '<p>Start again from the app.</p>');
      return;
    }
    try {
      const identity = await oidc.complete(state, code);
      const issued = await accounts.requestMagicLink(identity.email, 'signin');
      if (!issued) {
        page(
          res,
          403,
          'No account yet',
          '<p>Your sign-in worked, but there is no account for this address. Ask your DM for an invite link first.</p>',
        );
        return;
      }
      page(
        res,
        200,
        'Your sign-in code',
        `<p>Paste this into the app’s Connect screen, in the “Have a code? Type it here” box. It works once and expires in ${MAGIC_LINK_TTL_MINUTES} minutes.</p><code>${escapeHtml(issued.token)}</code>`,
      );
    } catch (error) {
      const message = error instanceof OidcError ? error.message : 'something went wrong';
      page(
        res,
        400,
        'Sign-in did not finish',
        `<p>${escapeHtml(message)}. Start again from the app.</p>`,
      );
    }
  });

  return router;
}
