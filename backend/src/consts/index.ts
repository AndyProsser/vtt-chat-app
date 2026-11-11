import { DEFAULT_AI_SETTINGS } from '@vtt-chat-app/shared';

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
  ai: DEFAULT_AI_SETTINGS,
};

/** Chat history kept per campaign (whispers included); older lines are pruned. Bounded retention. */
export const CHAT_RETENTION_MESSAGES = 5000;

/** One uploaded handout image/PDF. */
/** A portrait, after the app has shrunk it (a 256-pixel square is a few kilobytes). */
export const MAX_AVATAR_BYTES = 256 * 1024;
export const MAX_HANDOUT_BYTES = 10 * 1024 * 1024;
/** A campaign's handout files together; a runaway upload loop cannot fill the media volume. */
export const MAX_CAMPAIGN_HANDOUT_BYTES = 1024 * 1024 * 1024;
/** One soundboard clip, and one account's whole sound library. */
export const MAX_SOUND_BYTES = 5 * 1024 * 1024;
export const MAX_LIBRARY_BYTES = 200 * 1024 * 1024;
export const MAX_BOARD_BUTTONS = 60;
export const MAX_SCENE_LAYERS = 12;

export const MAX_TEXT_HANDOUT_CHARS = 20_000;
/** Pictures in one picture handout (a PDF handout is one file). */
export const MAX_HANDOUT_IMAGES = 12;

export const MAGIC_LINK_TTL_MINUTES = 15;
/** A link code is typed into the desktop app by someone already signed in on the web: short-lived. */
export const LINK_CODE_TTL_MINUTES = 5;
/** Speakable: no look-alike characters (no I, L, O, 0, 1). */
export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHORT_CODE_LENGTH = 8;
export const MIN_PASSWORD_LENGTH = 10;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

/**
 * The updater public key the desktop app trusts (the `pubkey` in `tauri-client/src-tauri/tauri.conf.json`; a test
 * keeps the two equal). The server checks mirrored installers against it before storing them. Override with
 * `UPDATER_PUBLIC_KEY` only for a fork that signs its own builds.
 */
export const UPDATER_PUBLIC_KEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU1RTNGMDc0MjU0OTg1ODkKUldTSmhVa2xkUERqVmRWUXJhazNaQ2IvQjVYQTk0UmRZNnJhUWd0QUNKcDdNWWhacmZia3YrQmsK';
