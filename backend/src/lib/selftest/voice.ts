import type { TestRow } from '@vtt-chat-app/shared';

import { isPublicHost } from './reach.js';

export interface VoiceDeps {
  /** Where the server talks to LiveKit (`LIVEKIT_HEALTH_URL`, or the public address with http for ws). */
  healthUrl: string;
  /** The address players' apps connect to (`LIVEKIT_URL`). */
  publicUrl: string;
  fetchImpl?: typeof fetch;
  /** Asks LiveKit for its rooms: proves the API key and secret are accepted. */
  listRooms: () => Promise<unknown[]>;
  /** Asks Egress (the recorder) for its jobs: proves it is reachable and authorised. */
  listEgress: () => Promise<unknown[]>;
  /** Whether this server records at all (a recordings folder is configured). */
  recordingConfigured: boolean;
}

const messageOf = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 160);

/**
 * `vtt-admin test voice`: is the voice server up, does it accept this server's keys, can sessions be recorded, and is the
 * address players are given sensible. The one thing it cannot see is the media ports from the outside: that is
 * `vtt-admin test reach` (the TCP one) and a phone off your Wi-Fi (UDP).
 */
export async function checkVoice(deps: VoiceDeps): Promise<TestRow[]> {
  const rows: TestRow[] = [];
  const doFetch = deps.fetchImpl ?? fetch;

  try {
    const res = await doFetch(deps.healthUrl, { signal: AbortSignal.timeout(5_000) });
    rows.push({
      badge: res.status < 500 ? 'ok' : 'fail',
      name: 'LiveKit server',
      detail: `${deps.healthUrl} answered ${res.status}`,
    });
    if (res.status >= 500) return rows;
  } catch (e) {
    rows.push({
      badge: 'fail',
      name: 'LiveKit server',
      detail: `${deps.healthUrl} did not answer (${messageOf(e)}). Is the livekit service running? (vtt-admin ps)`,
    });
    return rows;
  }

  try {
    const rooms = await deps.listRooms();
    rows.push({
      badge: 'ok',
      name: 'LiveKit keys',
      detail: `accepted; ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} in use right now`,
    });
  } catch (e) {
    rows.push({
      badge: 'fail',
      name: 'LiveKit keys',
      detail: `LiveKit refused this server's API key or secret (${messageOf(e)}). Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env.`,
    });
  }

  if (!deps.recordingConfigured) {
    rows.push({ badge: 'off', name: 'Recording (Egress)', detail: 'not set up on this server' });
  } else {
    try {
      await deps.listEgress();
      rows.push({
        badge: 'ok',
        name: 'Recording (Egress)',
        detail: 'the recorder answers, so a session can be recorded',
      });
    } catch (e) {
      rows.push({
        badge: 'fail',
        name: 'Recording (Egress)',
        detail: `the recorder did not answer (${messageOf(e)}), so a session would not be recorded. See: vtt-admin logs egress`,
      });
    }
  }

  let host = '';
  try {
    host = new URL(deps.publicUrl.replace(/^ws/, 'http')).hostname;
  } catch {
    /* handled below */
  }
  const secure = deps.publicUrl.startsWith('wss://');
  rows.push(
    secure && host && isPublicHost(host)
      ? { badge: 'ok', name: 'Address players use', detail: deps.publicUrl }
      : {
          badge: 'warn',
          name: 'Address players use',
          detail: `${deps.publicUrl}: a plain or private address works only on your own network (a LAN or --http install); players elsewhere cannot connect.`,
        },
  );

  rows.push({
    badge: 'off',
    name: 'Voice media ports',
    detail:
      'cannot be seen from inside this machine: UDP 50000-50200 and TCP 7881 must be forwarded to it. vtt-admin test reach checks 7881 from outside; a player joining voice from a phone off your Wi-Fi proves the UDP range.',
  });
  return rows;
}
