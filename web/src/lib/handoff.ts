/**
 * Hand-off from the landing page into the web app (`/app`): a single-use link token travels in the URL
 * fragment, which the browser never sends to a server and which the app removes before anything else.
 */
const KEY = 'connect';

/** `/app#connect=<token>`: the fragment keeps the token out of server logs and the query string. */
export function handoffUrl(linkToken: string): string {
  return `/app#${KEY}=${encodeURIComponent(linkToken)}`;
}

/** The token in a `#connect=…` fragment, or undefined when there is none (or it is empty or malformed). */
export function tokenFromHash(hash: string): string | undefined {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== KEY) continue;
    try {
      const value = decodeURIComponent(part.slice(eq + 1)).trim();
      return value === '' ? undefined : value;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The address without the `connect` fragment (other fragment parts are kept), for `history.replaceState`. */
export function stripTokenFromUrl(pathname: string, search: string, hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const rest = raw.split('&').filter((p) => p.split('=')[0] !== KEY && p !== '');
  return pathname + search + (rest.length > 0 ? `#${rest.join('&')}` : '');
}

/**
 * Takes the token out of the address bar before anything else happens (so it cannot be copied, shared or
 * synced from there) and returns it. Call once, on load.
 */
export function takeHandoffToken(): string | undefined {
  const token = tokenFromHash(window.location.hash);
  if (token === undefined) return undefined;
  try {
    history.replaceState(
      history.state,
      '',
      stripTokenFromUrl(window.location.pathname, window.location.search, window.location.hash),
    );
  } catch {
    /* nothing more to do: the token is single-use and expires in minutes */
  }
  return token;
}
