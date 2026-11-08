import type { RecordsStore } from '@vtt-chat-app/ai';
import express, { type Express } from 'express';

import { AccountService } from './auth/accountService.js';
import { CampaignService } from './campaigns/campaignService.js';
import type { BackendConfig } from './config.js';
import { inviteRoutes, webPages } from './http/joinRoutes.js';
import { authRoutes } from './http/authRoutes.js';
import { campaignRoutes } from './http/campaignRoutes.js';
import { NoMailTransport, type MagicLinkSender } from './http/delivery.js';
import { errorHandler } from './http/middleware.js';
import { RateLimiter } from './http/rateLimit.js';
import { handoutRoutes } from './http/handoutRoutes.js';
import { lootRoutes } from './http/lootRoutes.js';
import { notificationRoutes, sessionRoutes } from './http/scheduleRoutes.js';
import { soundLibraryRoutes, soundPlaybackRoutes } from './http/soundRoutes.js';
import { recordsRoutes } from './http/recordsRoutes.js';
import type { MediaStorage } from './media/mediaStorage.js';
import { ScheduleService } from './schedule/scheduleService.js';
import type { ScheduleStore } from './schedule/scheduleStore.js';
import { SoundLibraryService } from './soundboard/soundLibraryService.js';
import type { SoundStore } from './soundboard/soundStore.js';
import { HandoutService } from './table/handoutService.js';
import { LootService } from './table/lootService.js';
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
    announceLoot?(
      event: 'dropped' | 'claimed' | 'removed',
      item: {
        id: string;
        campaignId: string;
        name: string;
        quantity: number;
        claimedBy: string | null;
        kind: 'item' | 'coin';
        claimedFor: 'self' | 'party' | 'split' | null;
        split: { shares: { userId: string; amount: number }[]; remainder: number } | null;
      },
    ): void;
  };
  /** Shared with the realtime hub so REST changes and snapshots agree. Defaults to a fresh one. */
  recording?: RecordingState;
  /** A campaign's recorded history (transcripts, summaries, search). Omit to leave those routes off. */
  records?: RecordsStore;
  /** Handouts, maps, images and snippets. Omit to leave those routes off. */
  table?: TableStore;
  /** Where uploaded file bytes live. Without it only text snippets work. */
  media?: MediaStorage;
  /** The DM's sound library. Needs `table` and (for clips) `media`. */
  sounds?: SoundStore;
  /** Session schedule, RSVPs and stored notifications. */
  schedule?: ScheduleStore;
  /** Called after notifications are stored, so live sockets can be told straight away. */
  onNotified?: () => void;
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
  sounds,
  schedule,
  onNotified,
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

  const inviteLimiter = new RateLimiter(20, 15 * MINUTE);
  app.use(
    '/api/invites',
    inviteRoutes({ campaigns, downloads: config.clientDownloads, inviteLimiter }),
  );
  if (config.webDir) {
    const pages = webPages(config.webDir);
    if (pages) app.use(pages);
  }

  if (config.updatesDir) {
    // Signed installers and `latest.json`, produced by the release script. The tray app checks
    // `<server>/updates/latest.json`; the signature, not this endpoint, is what makes an update
    // trustworthy, so this is plain static serving — but never cached, or a new release is invisible.
    app.use(
      '/updates',
      express.static(config.updatesDir, {
        index: false,
        dotfiles: 'ignore',
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
      }),
    );
  }

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
      inviteLimiter,
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

  if (table) {
    app.use(
      '/api/campaigns/:campaignId/loot',
      lootRoutes({
        accounts,
        loot: new LootService({ store, table }),
        ...(realtime?.announceLoot
          ? { onChange: (event, item) => realtime.announceLoot?.(event, item) }
          : {}),
      }),
    );
  }

  if (table && sounds) {
    const library = new SoundLibraryService({ store, sounds, table, media });
    app.use('/api/soundboard', soundLibraryRoutes({ accounts, library }));
    app.use('/api/campaigns/:campaignId/sounds', soundPlaybackRoutes({ accounts, library }));
  }

  if (schedule) {
    const service = new ScheduleService({ store, schedule, ...(onNotified ? { onNotified } : {}) });
    app.use('/api/campaigns/:campaignId/sessions', sessionRoutes({ accounts, schedule: service }));
    app.use('/api/notifications', notificationRoutes({ accounts, schedule: service }));
  }

  app.use(errorHandler);
  return app;
}
