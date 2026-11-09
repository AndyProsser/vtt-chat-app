import {
  DEFAULT_PORT,
  DEV_LIVEKIT_API_KEY,
  DEV_LIVEKIT_API_SECRET,
  DEV_LIVEKIT_URL,
} from '../consts/index.js';

export interface ClientDownloads {
  windows?: string;
  macos?: string;
  linux?: string;
}

export interface BackendConfig {
  port: number;
  liveKitUrl: string;
  liveKitApiKey: string;
  liveKitApiSecret: string;
  /** Postgres connection string. Unset: in-memory state, lost on restart (dev only). */
  databaseUrl: string | undefined;
  /** Valkey/Redis URL for the replay buffer. Unset: in-memory, so a restart sends every client a snapshot. */
  valkeyUrl: string | undefined;
  /**
   * Directory LiveKit Egress writes recordings into, as Egress sees it (shared with the records
   * worker). Setting it switches audio capture on; unset, recording is only a state flag.
   */
  recordingsDir: string | undefined;
  /** Directory for uploaded files (handouts, soundboard clips). Unset: only text snippets work. */
  mediaDir: string | undefined;
  /** Built join page (`web/dist`). Unset: no browser pages are served and invites are API-only. */
  webDir: string | undefined;
  /**
   * Directory of client updates (`latest.json` plus the signed installers), served at `/updates`.
   * Unset: no update endpoint, and tray apps pointed at this server simply find no update.
   */
  updatesDir?: string | undefined;
  /** Where players download the tray app, per platform. Shown on the join page; all optional. */
  clientDownloads: ClientDownloads;
  /** LiveKit's HTTP API as the backend reaches it (room and Egress calls). */
  liveKitApiUrl: string;
  /**
   * Optional D&D Beyond character sync (`DDB_SYNC=1`). Off by default because it contacts a third
   * party; `DDB_SYNC_HOURS` is how stale a linked character may get before the timer refreshes it.
   */
  ddbSync: { enabled: boolean; intervalHours: number };
}

/**
 * Reads config from env vars, falling back to `livekit-server --dev`'s defaults for local
 * development. The dev LiveKit key/secret are public defaults — a deployed instance must set its
 * own (see ROADMAP Stage 3, which also adds session secrets once accounts exist).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  return {
    port: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
    liveKitUrl: env.LIVEKIT_URL ?? DEV_LIVEKIT_URL,
    liveKitApiKey: env.LIVEKIT_API_KEY ?? DEV_LIVEKIT_API_KEY,
    liveKitApiSecret: env.LIVEKIT_API_SECRET ?? DEV_LIVEKIT_API_SECRET,
    databaseUrl: env.DATABASE_URL || undefined,
    valkeyUrl: env.VALKEY_URL || undefined,
    recordingsDir: env.RECORDINGS_DIR || undefined,
    mediaDir: env.MEDIA_DIR || undefined,
    webDir: env.WEB_DIR || undefined,
    updatesDir: env.UPDATES_DIR || undefined,
    clientDownloads: {
      ...(env.CLIENT_URL_WINDOWS ? { windows: env.CLIENT_URL_WINDOWS } : {}),
      ...(env.CLIENT_URL_MACOS ? { macos: env.CLIENT_URL_MACOS } : {}),
      ...(env.CLIENT_URL_LINUX ? { linux: env.CLIENT_URL_LINUX } : {}),
    },
    ddbSync: {
      enabled: env.DDB_SYNC === '1' || env.DDB_SYNC === 'true',
      intervalHours: env.DDB_SYNC_HOURS ? Math.max(1, Number(env.DDB_SYNC_HOURS) || 12) : 12,
    },
    liveKitApiUrl:
      env.LIVEKIT_API_URL ??
      env.LIVEKIT_HEALTH_URL ??
      (env.LIVEKIT_URL ?? DEV_LIVEKIT_URL).replace(/^ws/, 'http'),
  };
}
