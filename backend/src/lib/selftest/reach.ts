import type { TestRow } from '@vtt-chat-app/shared';

/**
 * "Can people outside my network reach my server?", answered by check-host.net, a free public service that opens the
 * connections from several countries (https://check-host.net/about/api). Optional and only ever asked for by name
 * (`vtt-admin test reach`): it shares your server's host name with that service, and nothing depends on it.
 *
 * What it can prove is plain HTTP, HTTPS and the ICE-over-TCP port. What it cannot is voice's UDP: LiveKit opens a UDP port
 * only for a call that is in progress, so a probe of an idle server learns nothing, and a UDP probe that gets no
 * answer is the normal state of an open port too. The real proof is a player joining voice from a phone off Wi-Fi.
 */

const API = 'https://check-host.net';
const USER_AGENT = 'vtt-chat-app vtt-admin (self-hosted server reachability check)';
const ICE_TCP_PORT = 7881;
const POLL_EVERY_MS = 2_000;

export interface ReachOptions {
  /** The server's public host name (see {@link reachHost}). */
  host: string;
  fetchImpl?: typeof fetch;
  /** Injected for tests; the real one waits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to wait for the answers (default 30 s). */
  timeoutMs?: number;
  /** How many places to ask from (default 3). */
  maxNodes?: number;
}

/** The host name of the server's public address (`PUBLIC_URL`), or nothing when it is not set or not a web address. */
export function reachHost(publicUrl: string | undefined): string | undefined {
  if (!publicUrl) return undefined;
  try {
    return new URL(publicUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Whether a host name or address could be reached from the internet at all (a private or local one cannot). */
export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || /\.(local|lan|internal|home|localdomain)$/.test(h)) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(':')) return !(h === '::1' || /^f[cd]/.test(h) || h.startsWith('fe80'));
  return true;
}

type Place = [string, string, string, string, string]; // country code, country, city, ip, asn
interface Started {
  id: string;
  places: Record<string, Place>;
}
type Answers = Record<string, unknown>;

const placeName = (id: string, places: Record<string, Place>): string => places[id]?.[2] ?? id;

/** One check's answers, boiled down to who got through. */
function tally(
  started: Started,
  answers: Answers | undefined,
  works: (answer: unknown) => boolean,
): { ok: string[]; failed: string[]; pending: string[] } {
  const out = { ok: [] as string[], failed: [] as string[], pending: [] as string[] };
  for (const node of Object.keys(started.places)) {
    const answer = answers?.[node];
    if (answer === null || answer === undefined) out.pending.push(placeName(node, started.places));
    else if (works(answer)) out.ok.push(placeName(node, started.places));
    else out.failed.push(placeName(node, started.places));
  }
  return out;
}

const httpWorks = (answer: unknown): boolean => {
  const first = Array.isArray(answer) ? (answer[0] as unknown) : undefined;
  return Array.isArray(first) && first[0] === 1;
};
const tcpWorks = (answer: unknown): boolean => {
  const first = Array.isArray(answer) ? (answer[0] as unknown) : undefined;
  return typeof first === 'object' && first !== null && !('error' in first) && 'time' in first;
};

function detail(t: { ok: string[]; failed: string[]; pending: string[] }): string {
  const total = t.ok.length + t.failed.length + t.pending.length;
  const parts = [
    `${t.ok.length} of ${total} places reached it${t.ok.length ? ` (${t.ok.join(', ')})` : ''}`,
  ];
  if (t.failed.length) parts.push(`not from ${t.failed.join(', ')}`);
  if (t.pending.length) parts.push(`${t.pending.join(', ')} did not answer in time`);
  return parts.join('; ');
}

const warn = (name: string, text: string): TestRow => ({ badge: 'warn', name, detail: text });

/** Asks check-host.net to open the connections, waits for the answers, and says what it found. */
export async function checkReach(options: ReachOptions): Promise<TestRow[]> {
  const { host } = options;
  const name = 'Reach from outside';
  if (!isPublicHost(host)) {
    return [
      warn(
        name,
        `${host} is not a public address (it is private or local), so nothing outside your network can reach it. Set the server's public host name.`,
      ),
    ];
  }
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 30_000);
  const maxNodes = options.maxNodes ?? 3;
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };

  const get = async (path: string): Promise<unknown> => {
    const res = await doFetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`check-host.net answered ${res.status}`);
    return res.json();
  };
  const start = async (kind: 'http' | 'tcp', target: string): Promise<Started> => {
    const r = (await get(
      `/check-${kind}?host=${encodeURIComponent(target)}&max_nodes=${maxNodes}`,
    )) as { ok?: number; request_id?: string; nodes?: Record<string, Place> };
    if (r.ok !== 1 || !r.request_id || !r.nodes) throw new Error('refused');
    return { id: r.request_id, places: r.nodes };
  };

  let http: Started, https: Started, tcp: Started;
  try {
    [http, https, tcp] = await Promise.all([
      start('http', `http://${host}/`),
      start('http', `https://${host}/api/health`),
      start('tcp', `${host}:${ICE_TCP_PORT}`),
    ]);
  } catch (e) {
    return [
      warn(
        name,
        e instanceof Error && e.message === 'refused'
          ? 'check-host.net refused the request (it limits how often it can be asked). Try again later.'
          : `could not ask check-host.net (${e instanceof Error ? e.message : String(e)}). That is their service or your connection, not your server: try again later.`,
      ),
    ];
  }

  const checks = [http, https, tcp];
  const answers = new Map<string, Answers>();
  const done = (s: Started): boolean => {
    const a = answers.get(s.id);
    return !!a && Object.keys(s.places).every((n) => a[n] !== null && a[n] !== undefined);
  };
  while (!checks.every(done) && now() < deadline) {
    await sleep(POLL_EVERY_MS);
    for (const s of checks.filter((c) => !done(c))) {
      try {
        answers.set(s.id, (await get(`/check-result/${s.id}`)) as Answers);
      } catch {
        /* keep what we have; the next round or the deadline settles it */
      }
    }
  }

  const rowFor = (
    label: string,
    s: Started,
    works: (a: unknown) => boolean,
    onNone: 'fail' | 'warn',
    none: string,
  ): TestRow => {
    const t = tally(s, answers.get(s.id), works);
    const everyone = t.failed.length === 0 && t.pending.length === 0;
    if (t.ok.length > 0 && everyone) return { badge: 'ok', name: label, detail: detail(t) };
    if (t.ok.length === 0 && t.failed.length > 0) {
      return { badge: onNone, name: label, detail: `${detail(t)}. ${none}` };
    }
    return warn(label, detail(t));
  };
  return [
    rowFor(
      'HTTP (80)',
      http,
      httpWorks,
      'fail',
      'Port 80 is not reaching the server; check the router forwards it.',
    ),
    rowFor(
      'HTTPS (443)',
      https,
      httpWorks,
      'fail',
      'Port 443 is not reaching the server, or the backend is down; players cannot sign in.',
    ),
    rowFor(
      'Voice TCP (7881)',
      tcp,
      tcpWorks,
      'warn',
      'The ICE-over-TCP fallback is closed, so players on networks that block UDP cannot join voice. Forward 7881/tcp.',
    ),
    {
      badge: 'off',
      name: 'Voice UDP',
      detail:
        'cannot be proved from outside: voice opens a UDP port only for a call in progress. Join voice from a phone off your Wi-Fi to prove it (vtt-admin test voice checks your server’s side).',
    },
  ];
}
