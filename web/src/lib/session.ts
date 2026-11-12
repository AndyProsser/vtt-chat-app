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

/** How long Sign out waits for the server before it gives up and clears this tab anyway. */
export const SIGN_OUT_TIMEOUT_MS = 3_000;

export type SignOutResult = { ok: true } | { ok: false; message: string };

/**
 * Ends the session on the server (which clears the cookie), and only then here, so the page never claims
 * "signed out" while the cookie is still good:
 *  - the server confirms (or says the cookie was already dead, a 401): signed out;
 *  - the server answers but refuses (a 5xx, a 403): the cookie is still valid, so the tab stays signed in
 *    and the caller shows the message;
 *  - no answer within the timeout, or the network is down: the tab is cleared anyway (the person asked to
 *    leave; the cookie, if it survived, simply signs the next visit in again).
 */
export async function signOut(
  options: { timeoutMs?: number; logout?: (signal: AbortSignal) => Promise<unknown> } = {},
): Promise<SignOutResult> {
  const logout = options.logout ?? signOutApi;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SIGN_OUT_TIMEOUT_MS);
  try {
    await logout(controller.signal);
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      return { ok: false, message: 'Could not sign out. Please try again.' };
    }
    // A 401, a timeout or a network failure: clear this tab.
  } finally {
    clearTimeout(timer);
  }
  set('out');
  inFlight = undefined;
  return { ok: true };
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
