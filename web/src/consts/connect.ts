/** Mirrors the backend's link-code lifetime (5 minutes). Expiry is judged on the client clock from receipt, never from the server's timestamp. */
export const LINK_CODE_TTL_MS = 5 * 60_000;

/** Shown on the approval page when the app sent no label, or the server recorded no address. */
export const UNKNOWN_DEVICE = 'Unknown device';
export const UNKNOWN_ADDRESS = 'unknown address';

/** Treat the code as gone slightly early so nobody races the server's real expiry. */
export const LINK_CODE_MARGIN_MS = 5_000;
