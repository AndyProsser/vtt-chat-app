/** The browser session exists to connect the app; it ends after this long even if the tab stays open. */
export const SESSION_LIFETIME_MS = 10 * 60 * 1000;

/** Mirrors the backend's link-code lifetime (5 minutes). Expiry is judged on the client clock from receipt, never from the server's timestamp. */
export const LINK_CODE_TTL_MS = 5 * 60_000;

/** Treat the code as gone slightly early so nobody races the server's real expiry. */
export const LINK_CODE_MARGIN_MS = 5_000;
