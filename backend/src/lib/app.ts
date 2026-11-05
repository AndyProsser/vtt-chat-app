import express, { type Express } from 'express';

import { AccountService } from './auth/accountService.js';
import { CampaignService } from './campaigns/campaignService.js';
import type { BackendConfig } from './config.js';
import { authRoutes } from './http/authRoutes.js';
import { campaignRoutes } from './http/campaignRoutes.js';
import { NoMailTransport, type MagicLinkSender } from './http/delivery.js';
import { errorHandler } from './http/middleware.js';
import { RateLimiter } from './http/rateLimit.js';
import type { Store } from './store/store.js';

export interface AppDeps {
  config: BackendConfig;
  store: Store;
  /** Delivers magic-link tokens. Defaults to "not configured". */
  sender?: MagicLinkSender;
}

const MINUTE = 60_000;

/**
 * The REST surface — the rare, heavy actions (sign-up, sign-in, password/profile changes, creating
 * campaigns, invites, voice tokens). Everything live and frequent goes over the WebSocket layer
 * instead (docs/architecture/SYNC-PROTOCOL.md), which is not built yet.
 */
export function createApp({ config, store, sender }: AppDeps): Express {
  const accounts = new AccountService({ store });
  const campaigns = new CampaignService({ store });

  const app = express();
  // Behind Caddy on the same host; trust it for the real client address (used by the rate limiters).
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(
    '/api/auth',
    authRoutes({
      accounts,
      sender: sender ?? new NoMailTransport(),
      loginLimiter: new RateLimiter(10, 15 * MINUTE),
      linkLimiter: new RateLimiter(10, 15 * MINUTE),
    }),
  );
  app.use(
    '/api/campaigns',
    campaignRoutes({
      accounts,
      campaigns,
      store,
      liveKit: {
        url: config.liveKitUrl,
        apiKey: config.liveKitApiKey,
        apiSecret: config.liveKitApiSecret,
      },
      inviteLimiter: new RateLimiter(20, 15 * MINUTE),
    }),
  );

  app.use(errorHandler);
  return app;
}
