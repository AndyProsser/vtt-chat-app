import type { TestRow } from '@vtt-chat-app/shared';

import { classifyIp } from './address.js';
import { isCloudflareIp } from './cloudflare.js';
import { checkNetwork, type NetworkOptions } from './network.js';

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
const POLL_EVERY_MS = 2_000;

/** Where the web side of this server answers. */
export interface WebTarget {
  host: string;
  scheme: 'http' | 'https';
  port: number;
}
/** Where voice's ICE-over-TCP fallback answers: the voice address, which need not be the web host (web behind Cloudflare, voice direct). */
export interface VoiceTarget {
  host: string;
  port: number;
}

export interface ReachOptions {
  web: WebTarget;
  voice: VoiceTarget;
  fetchImpl?: typeof fetch;
  /** Injected for tests; the real one waits. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to wait for the answers (default 30 s). */
  timeoutMs?: number;
  /** How many places to ask from (default 3). */
  maxNodes?: number;
  /** When given, also checks the server's own address and DNS, and diagnoses CGNAT (see network.ts). */
  network?: Pick<NetworkOptions, 'resolve' | 'publicAddress'>;
}

/**
 * What to check, from the server's public address (`PUBLIC_URL`) and its voice address (`VOICE_ADDRESS`, set by `vtt-admin
 * voice-address`): the scheme and port the site is really served on (a `--port` install is not on 443), and the voice host,
 * which is the web host unless the operator pointed voice somewhere else. Nothing when there is no web address to check.
 */
export function reachTargets(
  publicUrl: string | undefined,
  voiceAddress: string | undefined,
  voiceTcpPort = 7881,
): { web: WebTarget; voice: VoiceTarget } | undefined {
  if (!publicUrl) return undefined;
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return undefined;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return undefined;
  const scheme = url.protocol === 'https:' ? 'https' : 'http';
  const port = url.port ? Number(url.port) : scheme === 'https' ? 443 : 80;
  const address = voiceAddress?.trim();
  const voiceHost = address && address.toLowerCase() !== 'auto' ? address : url.hostname;
  return {
    web: { host: url.hostname, scheme, port },
    voice: { host: voiceHost, port: voiceTcpPort },
  };
}

/** Whether a host name or address could be reached from the internet at all (a private, shared or local one cannot). */
export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || /\.(local|lan|internal|home|localdomain)$/.test(h)) return false;
  const kind = classifyIp(h);
  return kind === undefined || kind === 'public';
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

interface Spec {
  label: string;
  kind: 'http' | 'tcp';
  target: string;
  works: (answer: unknown) => boolean;
  onNone: 'fail' | 'warn';
  none: string;
}

const CLOUDFLARE_HINT =
  " If your web address is proxied by Cloudflare, port 7881 never passes through it: point voice at your server's own address with vtt-admin voice-address <ip>, and this test will check that one.";

/** Asks check-host.net to open the connections, waits for the answers, and says what it found. */
export async function checkReach(options: ReachOptions): Promise<TestRow[]> {
  const { web } = options;
  let voice = options.voice;
  const name = 'Reach from outside';
  if (!isPublicHost(web.host)) {
    return [
      warn(
        name,
        `${web.host} is not a public address (it is private or local), so nothing outside your network can reach it. Set the server's public host name.`,
      ),
    ];
  }
  // Web behind Cloudflare and no voice address chosen: voice cannot go through Cloudflare, so check it at this server's own address.
  const autoRows: TestRow[] = [];
  let skipVoice = false;
  if (options.network && voice.host.toLowerCase() === web.host.toLowerCase()) {
    const addresses = await options.network.resolve(web.host).catch(() => [] as string[]);
    if (addresses.length > 0 && addresses.every(isCloudflareIp)) {
      const own = await options.network.publicAddress();
      if (own && classifyIp(own) === 'public') {
        voice = { host: own, port: voice.port };
        autoRows.push({
          badge: 'ok',
          name: 'Voice address',
          detail: `${web.host} is behind Cloudflare, which cannot carry voice, so voice is checked at this server's own address ${own}. Make sure voice points there (vtt-admin voice-address).`,
        });
      } else {
        autoRows.push(
          warn(
            'Voice address',
            `${web.host} is behind Cloudflare, which cannot carry voice, and this server's own address could not be learned, so voice was not checked. Set it with vtt-admin voice-address <address>.`,
          ),
        );
        skipVoice = true;
      }
    }
  }
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 30_000);
  const maxNodes = options.maxNodes ?? 3;
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };

  const defaultPort = web.scheme === 'https' ? 443 : 80;
  const hostPort = `${web.host}${web.port === defaultPort ? '' : `:${web.port}`}`;
  const specs: Spec[] = [];
  const preRows: TestRow[] = [];
  if (web.scheme === 'https' && web.port === 443) {
    specs.push(
      {
        label: 'HTTP (80)',
        kind: 'http',
        target: `http://${web.host}/`,
        works: httpWorks,
        onNone: 'fail',
        none: 'Port 80 is not reaching the server; check the router forwards it (HTTPS certificates need it too, unless you use the DNS challenge).',
      },
      {
        label: 'HTTPS (443)',
        kind: 'http',
        target: `https://${web.host}/api/health`,
        works: httpWorks,
        onNone: 'fail',
        none: 'Port 443 is not reaching the server, or the backend is down; players cannot sign in.',
      },
    );
  } else {
    specs.push({
      label: `Web (${web.scheme}://${hostPort})`,
      kind: 'http',
      target: `${web.scheme}://${hostPort}/api/health`,
      works: httpWorks,
      onNone: 'fail',
      none: `Port ${web.port} is not reaching the server, or the backend is down; players cannot sign in.`,
    });
  }
  const sameHost = voice.host.toLowerCase() === web.host.toLowerCase();
  const voiceLabel =
    sameHost && voice.port === 7881
      ? 'Voice TCP (7881)'
      : `Voice TCP (${voice.host}:${voice.port})`;
  if (skipVoice) {
    // already explained by the Voice address row
  } else if (!isPublicHost(voice.host)) {
    preRows.push(
      warn(
        voiceLabel,
        `${voice.host} is not a public address (it is private or local), so nothing outside can reach voice there. Set the voice address to your public address (vtt-admin voice-address).`,
      ),
    );
  } else {
    specs.push({
      label: voiceLabel,
      kind: 'tcp',
      target: `${voice.host}:${voice.port}`,
      works: tcpWorks,
      onNone: 'warn',
      none:
        'The ICE-over-TCP fallback is closed, so players on networks that block UDP cannot join voice. Forward ' +
        `${voice.port}/tcp.${sameHost ? CLOUDFLARE_HINT : ''}`,
    });
  }

  const get = async (path: string): Promise<unknown> => {
    const res = await doFetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`check-host.net answered ${res.status}`);
    return res.json();
  };
  const start = async (spec: Spec): Promise<Started> => {
    const r = (await get(
      `/check-${spec.kind}?host=${encodeURIComponent(spec.target)}&max_nodes=${maxNodes}`,
    )) as { ok?: number; request_id?: string; nodes?: Record<string, Place> };
    if (r.ok !== 1 || !r.request_id || !r.nodes) throw new Error('refused');
    return { id: r.request_id, places: r.nodes };
  };

  let started: Started[];
  try {
    started = await Promise.all(specs.map(start));
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

  const answers = new Map<string, Answers>();
  const done = (s: Started): boolean => {
    const a = answers.get(s.id);
    return !!a && Object.keys(s.places).every((n) => a[n] !== null && a[n] !== undefined);
  };
  while (!started.every(done) && now() < deadline) {
    await sleep(POLL_EVERY_MS);
    for (const s of started.filter((c) => !done(c))) {
      try {
        answers.set(s.id, (await get(`/check-result/${s.id}`)) as Answers);
      } catch {
        /* keep what we have; the next round or the deadline settles it */
      }
    }
  }

  const none = new Map<string, boolean>(); // label -> true when no place reached it at all
  const rows = specs.map((spec, i): TestRow => {
    const t = tally(started[i]!, answers.get(started[i]!.id), spec.works);
    none.set(spec.label, t.ok.length === 0 && t.failed.length > 0);
    const everyone = t.failed.length === 0 && t.pending.length === 0;
    if (t.ok.length > 0 && everyone) return { badge: 'ok', name: spec.label, detail: detail(t) };
    if (t.ok.length === 0 && t.failed.length > 0) {
      return { badge: spec.onNone, name: spec.label, detail: `${detail(t)}. ${spec.none}` };
    }
    return warn(spec.label, detail(t));
  });
  const webRows = rows.filter((r) => !r.name.startsWith('Voice'));
  const voiceRows = rows.filter((r) => r.name.startsWith('Voice'));
  // "Nothing outside gets in" is only a verdict when every place failed every time, not when answers were just late.
  const unreachable = (rs: TestRow[]): boolean | undefined =>
    rs.length === 0
      ? undefined
      : rs.every((r) => none.get(r.name))
        ? false
        : rs.every((r) => r.badge === 'ok')
          ? true
          : undefined;
  const networkRows = options.network
    ? await checkNetwork({
        webHost: web.host,
        voiceHost: voice.host,
        ...options.network,
        webReachable: unreachable(webRows),
        voiceReachable: unreachable(voiceRows),
      })
    : [];
  // The voice row goes after the web rows, then UDP, in the order people read them.
  return [
    ...networkRows,
    ...autoRows,
    ...webRows,
    ...voiceRows,
    ...preRows,
    {
      badge: 'off',
      name: 'Voice UDP',
      detail:
        'cannot be proved from outside: voice opens a UDP port only for a call in progress. Join voice from a phone off your Wi-Fi to prove it (vtt-admin test voice checks your server’s side).',
    },
  ];
}
