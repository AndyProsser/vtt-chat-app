import { CHARACTER_SERVICE_URL, REQUEST_TIMEOUT_MS, USER_AGENT } from '../consts/index.js';
import type { DdbCharacter, FetchLike } from '../types/index.js';
import { parseCharacter } from './parseCharacter.js';

export type FetchOutcome =
  | { ok: true; character: DdbCharacter }
  | { ok: false; reason: 'private' | 'not_found' | 'unavailable' | 'unreadable' };

/**
 * Reads a public character. 'private' means the owner has not made the sheet public (the service refuses
 * it); 'unavailable' is anything transient, so a periodic sync keeps the last good data and tries again.
 */
export async function fetchCharacter(
  id: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<FetchOutcome> {
  let response;
  try {
    response = await fetchFn(`${CHARACTER_SERVICE_URL}/${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (response.status === 404) return { ok: false, reason: 'not_found' };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: 'private' };
  if (!response.ok) return { ok: false, reason: 'unavailable' };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const character = parseCharacter(body);
  return character ? { ok: true, character } : { ok: false, reason: 'unreadable' };
}

/** Whether a portrait address is on a host we are willing to fetch from. */
export function portraitAllowed(url: string, hosts: readonly string[]): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    );
  } catch {
    return false;
  }
}
