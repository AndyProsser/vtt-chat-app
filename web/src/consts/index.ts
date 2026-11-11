/** Shown beside the consent checkbox. The backend only checks the version; this is the wording. */
export const CONSENT_TEXT =
  'Sessions in this campaign may be recorded. When one starts you will hear a cue, and a ' +
  'recording indicator stays visible. Recordings are transcribed and summarised on this ' +
  'server for your campaign. Whispers and private audio are never recorded.';

export const MIN_PASSWORD_LENGTH = 10;

/** The app registers this scheme; the join page offers it so the app opens already pointed here. */
export const APP_SCHEME = 'vtt-chat';

export const PLATFORM_LABELS = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
} as const;
export * from './connect.js';
