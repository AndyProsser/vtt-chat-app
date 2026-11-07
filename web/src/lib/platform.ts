import type { Platform } from '../types/index.js';

/** Best-effort guess from the user agent; the page always lists every platform too. */
export function detectPlatform(userAgent: string): Platform {
  if (/android|iphone|ipad|ipod/i.test(userAgent)) return 'other';
  if (/windows/i.test(userAgent)) return 'windows';
  if (/macintosh|mac os x/i.test(userAgent)) return 'macos';
  if (/linux|x11/i.test(userAgent)) return 'linux';
  return 'other';
}

/** `/join/ABCD-EFGH` → `ABCD-EFGH`; `/join` → undefined. */
export function codeFromPath(pathname: string): string | undefined {
  const match = /^\/join\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** `vtt-chat://connect?server=https%3A%2F%2Fhost` — the app opens already pointed at this server. */
export function appLink(scheme: string, serverUrl: string): string {
  return `${scheme}://connect?server=${encodeURIComponent(serverUrl)}`;
}
