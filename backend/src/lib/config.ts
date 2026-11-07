import {
  DEFAULT_PORT,
  DEV_LIVEKIT_API_KEY,
  DEV_LIVEKIT_API_SECRET,
  DEV_LIVEKIT_URL,
} from '../consts/index.js';

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
  /** LiveKit's HTTP API as the backend reaches it (room and Egress calls). */
  liveKitApiUrl: string;
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
    liveKitApiUrl:
      env.LIVEKIT_API_URL ??
      env.LIVEKIT_HEALTH_URL ??
      (env.LIVEKIT_URL ?? DEV_LIVEKIT_URL).replace(/^ws/, 'http'),
  };
}
