import { ApiError, checkSession, signOut as signOutApi } from './api.js';

/**
 * The browser's signed-in state for the pages (/, /download, /join, /connect, /status, /app).
 *
 * The session itself is an HttpOnly cookie that only the server can read or write, so there is no token
 * here: this module holds one fact, "does the server accept this browser's cookie", and learns it by
 * asking `GET /api/auth/me` (which also slides the cookie's expiry, so opening any page keeps a returning
 * player signed in). It lives in memory only; every page load asks again. Nothing is written to storage.
 */

/** Dispatched on `window` whenever the state changes, so a page can react without a reload. */
export const SESSION_EVENT = 'vtt-chat:session';

export type SessionState = 'unknown' | 'in' | 'out';

let state: SessionState = 'unknown';
let inFlight: Promise<void> | undefined;

function set(next: SessionState): void {
  if (state === next) return;
  state = next;
  try {
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    // no window (tests, SSR): nothing to tell
  }
}

export const getSessionState = (): SessionState => state;

export const hasSession = (): boolean => state === 'in';

/** A sign-in just succeeded (the response set the cookie). */
export function markSignedIn(): void {
  set('in');
}

/** The server no longer accepts the cookie, or the person signed out. */
export function markSignedOut(): void {
  set('out');
}

/**
 * Asks the server once per page load (concurrent callers share the answer). Only a refusal means signed
 * out; a network failure leaves the state unknown, so the page can try again rather than show a sign-in
 * form to someone who is merely offline.
 */
export function refreshSession(): Promise<void> {
  forgetLegacyToken();
  inFlight ??= checkSession().then(
    () => set('in'),
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) set('out');
    },
  );
  return inFlight;
}

/** Earlier builds kept the token in `sessionStorage`; it is a cookie now, so drop any leftover. */
function forgetLegacyToken(): void {
  try {
    globalThis.sessionStorage?.removeItem('vtt-chat.session');
  } catch {
    // storage blocked: nothing was kept there either
  }
}

/** Ends the session on the server (which clears the cookie) and here. */
export async function signOut(): Promise<void> {
  set('out');
  inFlight = undefined;
  await signOutApi();
}

/** For `useSyncExternalStore`. */
export function subscribeSession(onChange: () => void): () => void {
  window.addEventListener(SESSION_EVENT, onChange);
  return () => window.removeEventListener(SESSION_EVENT, onChange);
}

/** Test seam: forget everything. */
export function resetSession(): void {
  state = 'unknown';
  inFlight = undefined;
}
