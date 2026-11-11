import {
  DEFAULT_PORT,
  DEV_LIVEKIT_API_KEY,
  DEV_LIVEKIT_API_SECRET,
  DEV_LIVEKIT_URL,
} from '../consts/index.js';

import { UPDATER_PUBLIC_KEY } from '../consts/index.js';
import type { OidcConfig } from './auth/oidc.js';

export interface ClientDownloads {
  windows?: string;
  macos?: string;
  linux?: string;
}

export interface UpdatesSyncConfig {
  source: 'github' | 'mirror';
  repo: string;
  includeDev: boolean;
  publicUrl: string | undefined;
  publicKey: string;
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
  /**
   * How long the DM (or everyone) may be disconnected during a recording before something happens: after
   * this long without the DM, any player may pause, resume or stop it; after this long with nobody
   * connected, it stops by itself. `RECORDING_GRACE_SECONDS`, default 30.
   */
  recordingGraceSeconds: number;
  /**
   * Testing only: also save the DM's soundboard track as its own private file (never transcribed).
   * Off by default, because effects are deliberately not part of the session record.
   */
  recordSoundboard: boolean;
  /** Directory for uploaded files (handouts, soundboard clips). Unset: only text snippets work. */
  mediaDir: string | undefined;
  /** Built join page (`web/dist`). Unset: no browser pages are served and invites are API-only. */
  webDir: string | undefined;
  /** Built status page (`status/dist`), served at `/status`. Unset: only `/api/status` (the data) exists. */
  statusDir: string | undefined;
  /**
   * Directory of client updates (`latest.json` plus the signed installers), served at `/updates`.
   * Unset: no update endpoint, and tray apps pointed at this server simply find no update.
   */
  updatesDir?: string | undefined;
  /**
   * Keep `/updates` in step with GitHub releases on its own (`UPDATES_SOURCE=github|mirror`; needs `UPDATES_DIR`).
   * `github`: players download from GitHub. `mirror`: this server downloads, verifies and serves the installers.
   * Unset: only what `vtt-admin updates publish` put there. Design: docs/architecture/VERSIONING-AND-DEPLOYMENT.md.
   */
  updatesSync?: UpdatesSyncConfig | undefined;
  /** Where players download the tray app, per platform. Shown on the join page; all optional. */
  clientDownloads: ClientDownloads;
  /** LiveKit's HTTP API as the backend reaches it (room and Egress calls). */
  liveKitApiUrl: string;
  /**
   * Optional D&D Beyond character sync (`DDB_SYNC=1`). Off by default because it contacts a third
   * party; `DDB_SYNC_HOURS` is how stale a linked character may get before the timer refreshes it.
   */
  /** Outbound mail for magic links (`SMTP_URL`, e.g. smtps://user:pass@mail.example.com:465, plus `MAIL_FROM`). Unset: the Admin CLI issues codes. */
  /** Optional single sign-on (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `PUBLIC_URL` for the redirect). */
  oidc: OidcConfig | undefined;
  smtp: { url: string; from: string } | undefined;
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
    recordingGraceSeconds: graceSeconds(env.RECORDING_GRACE_SECONDS),
    recordSoundboard: env.RECORD_SOUNDBOARD === '1',
    mediaDir: env.MEDIA_DIR || undefined,
    webDir: env.WEB_DIR || undefined,
    statusDir: env.STATUS_DIR || undefined,
    updatesDir: env.UPDATES_DIR || undefined,
    updatesSync: updatesSync(env),
    clientDownloads: {
      ...(env.CLIENT_URL_WINDOWS ? { windows: env.CLIENT_URL_WINDOWS } : {}),
      ...(env.CLIENT_URL_MACOS ? { macos: env.CLIENT_URL_MACOS } : {}),
      ...(env.CLIENT_URL_LINUX ? { linux: env.CLIENT_URL_LINUX } : {}),
    },
    oidc:
      env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.PUBLIC_URL
        ? {
            issuer: env.OIDC_ISSUER,
            clientId: env.OIDC_CLIENT_ID,
            clientSecret: env.OIDC_CLIENT_SECRET,
            redirectUri: `${env.PUBLIC_URL.replace(/\/$/, '')}/api/auth/oidc/callback`,
          }
        : undefined,
    smtp: env.SMTP_URL
      ? { url: env.SMTP_URL, from: env.MAIL_FROM ?? 'VTT Chat <no-reply@localhost>' }
      : undefined,
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

/** The recording grace period: whole seconds from 5 to 3600, 30 when unset or unreadable. */
export function graceSeconds(raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(n)) return 30;
  return Math.min(3600, Math.max(5, Math.round(n)));
}

function updatesSync(env: NodeJS.ProcessEnv): UpdatesSyncConfig | undefined {
  const source = env.UPDATES_SOURCE;
  if (!env.UPDATES_DIR || (source !== 'github' && source !== 'mirror')) return undefined;
  return {
    source,
    repo: env.UPDATES_GITHUB_REPO || 'AndyProsser/vtt-chat-app',
    includeDev: env.UPDATES_INCLUDE_DEV === '1',
    publicUrl: env.PUBLIC_URL || undefined,
    publicKey: env.UPDATER_PUBLIC_KEY || UPDATER_PUBLIC_KEY,
  };
}
