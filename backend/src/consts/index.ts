import type { InstanceSettings } from '../types/index.js';

export const DEFAULT_PORT = 4000;

/** Matches `livekit-server --dev`'s printed defaults — see DEVELOPING.md. */
export const DEV_LIVEKIT_URL = 'ws://127.0.0.1:7880';
export const DEV_LIVEKIT_API_KEY = 'devkey';
export const DEV_LIVEKIT_API_SECRET = 'secret';

/**
 * Starting values for a fresh instance. Andy decided the 30-day offline limit (2026-11-05); the
 * invite expiry and magic-link lifetime are assumptions pending his say-so. All are overridable
 * through the Admin CLI.
 */
export const DEFAULT_INSTANCE_SETTINGS: InstanceSettings = {
  campaignCreation: 'closed',
  offlineLimitDays: 30,
  inviteExpiryDays: 7,
  consentVersion: '1',
};

export const MAGIC_LINK_TTL_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 10;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
