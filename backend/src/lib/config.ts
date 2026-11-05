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
  };
}
