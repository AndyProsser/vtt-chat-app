import type { RecordsStore } from '@vtt-chat-app/ai';
import express, { type Express } from 'express';

import { AccountService } from './auth/accountService.js';
import { CampaignService } from './campaigns/campaignService.js';
import type { BackendConfig } from './config.js';
import { authRoutes } from './http/authRoutes.js';
import { campaignRoutes } from './http/campaignRoutes.js';
import { NoMailTransport, type MagicLinkSender } from './http/delivery.js';
import { errorHandler } from './http/middleware.js';
import { RateLimiter } from './http/rateLimit.js';
import { handoutRoutes } from './http/handoutRoutes.js';
import { recordsRoutes } from './http/recordsRoutes.js';
import type { MediaStorage } from './media/mediaStorage.js';
import { HandoutService } from './table/handoutService.js';
import type { TableStore } from './table/tableStore.js';
import { RecordingState } from './recording/recordingState.js';
import type { RecordingChange } from './recording/recordingState.js';
import type { Store } from './store/store.js';

export interface AppDeps {
  config: BackendConfig;
  store: Store;
  /** Delivers magic-link tokens. Defaults to "not configured". */
  sender?: MagicLinkSender;
  /** Realtime hooks, so REST changes reach live sockets. Optional: REST works without a hub. */
  realtime?: {
    revokeSession(sessionId: string): void;
    announceRosterChanged(campaignId: string): void;
    announceRecording(change: RecordingChange): void;
    announceHandoutShown?(
      campaignId: string,
      handout: { id: string; title: string; kind: string },
      audience: { everyone: boolean; userIds: string[] },
      dmIds: string[],
    ): void;
    announceHandoutRemoved?(campaignId: string, handoutId: string): void;
  };
  /** Shared with the realtime hub so REST changes and snapshots agree. Defaults to a fresh one. */
  recording?: RecordingState;
  /** A campaign's recorded history (transcripts, summaries, search). Omit to leave those routes off. */
  records?: RecordsStore;
  /** Handouts, maps, images and snippets. Omit to leave those routes off. */
  table?: TableStore;
  /** Where uploaded file bytes live. Without it only text snippets work. */
  media?: MediaStorage;
}

const MINUTE = 60_000;

/**
 * The REST surface — the rare, heavy actions (sign-up, sign-in, password/profile changes, creating
 * campaigns, invites, voice tokens). Everything live and frequent goes over the WebSocket layer
 * instead (`realtime/`, docs/architecture/SYNC-PROTOCOL.md); the `realtime` hooks below connect the two.
 */
export function createApp({
  config,
  store,
  sender,
  realtime,
  recording,
  records,
  table,
  media,
}: AppDeps): Express {
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
      ...(realtime ? { onSessionRevoked: (id: string) => realtime.revokeSession(id) } : {}),
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
      recording: recording ?? new RecordingState(),
      ...(realtime ? { onRosterChanged: (id: string) => realtime.announceRosterChanged(id) } : {}),
      ...(realtime
        ? { onRecordingChanged: (change: RecordingChange) => realtime.announceRecording(change) }
        : {}),
    }),
  );

  if (records) {
    app.use('/api/campaigns/:campaignId/recordings', recordsRoutes({ accounts, store, records }));
  }

  if (table) {
    const handouts = new HandoutService({ store, table, media });
    app.use(
      '/api/campaigns/:campaignId/handouts',
      handoutRoutes({
        accounts,
        handouts,
        ...(realtime?.announceHandoutShown
          ? {
              onShown: (campaignId, handout, audience) => {
                void store.listMemberships(campaignId).then((ms) =>
                  realtime.announceHandoutShown?.(
                    campaignId,
                    handout,
                    audience,
                    ms.filter((m) => m.role === 'dm').map((m) => m.userId),
                  ),
                );
              },
            }
          : {}),
        ...(realtime?.announceHandoutRemoved
          ? {
              onRemoved: (campaignId, handoutId) =>
                realtime.announceHandoutRemoved?.(campaignId, handoutId),
            }
          : {}),
      }),
    );
  }

  app.use(errorHandler);
  return app;
}
