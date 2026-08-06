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
  appJwtSecret: string;
}

/**
 * Reads config from env vars, falling back to `livekit-server --dev`'s defaults for local
 * development. `APP_JWT_SECRET` has no safe default in a shared/deployed environment, but Stage 1
 * is dev-only per the roadmap, so a fallback keeps `npm run dev` usable without extra setup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  return {
    port: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
    liveKitUrl: env.LIVEKIT_URL ?? DEV_LIVEKIT_URL,
    liveKitApiKey: env.LIVEKIT_API_KEY ?? DEV_LIVEKIT_API_KEY,
    liveKitApiSecret: env.LIVEKIT_API_SECRET ?? DEV_LIVEKIT_API_SECRET,
    appJwtSecret: env.APP_JWT_SECRET ?? 'dev-only-insecure-app-jwt-secret',
  };
}
