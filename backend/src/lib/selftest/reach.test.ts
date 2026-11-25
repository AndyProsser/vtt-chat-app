import { describe, expect, it } from 'vitest';

import { checkReach, reachTargets, type ReachOptions } from './reach.js';

type Node = [string, string, string, string, string];
const NODES: Record<string, Node> = {
  'us1.node.check-host.net': ['us', 'USA', 'Los Angeles', '1.1.1.1', 'AS1'],
  'ch1.node.check-host.net': ['ch', 'Switzerland', 'Zurich', '2.2.2.2', 'AS2'],
  'pt1.node.check-host.net': ['pt', 'Portugal', 'Viana', '3.3.3.3', 'AS3'],
};

/** A pretend check-host.net: you say what each kind of check finds, it answers like the real API. */
function fakeCheckHost(
  answers: {
    http?: Record<string, unknown>;
    https?: Record<string, unknown>;
    tcp?: Record<string, unknown>;
    pendingPolls?: number;
    startOk?: 0 | 1;
    down?: boolean;
  } = {},
) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const ids = new Map<string, Record<string, unknown>>();
  let polls = 0;
  const allOk = (kind: 'http' | 'tcp'): Record<string, unknown> =>
    Object.fromEntries(
      Object.keys(NODES).map((n) => [
        n,
        kind === 'http' ? [[1, 0.1, 'OK', '200', '9.9.9.9']] : [{ time: 0.05, address: '9.9.9.9' }],
      ]),
    );
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (answers.down) throw new Error('getaddrinfo ENOTFOUND check-host.net');
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const start = /check-(http|tcp)\?host=([^&]+)/.exec(url);
    if (start) {
      if (answers.startOk === 0) return json({ ok: 0, error: 'limit_exceeded' });
      const target = decodeURIComponent(start[2]!);
      const kind = start[1] === 'tcp' ? 'tcp' : target.startsWith('https://') ? 'https' : 'http';
      const id = `${kind}-${ids.size}`;
      ids.set(id, answers[kind] ?? allOk(kind === 'tcp' ? 'tcp' : 'http'));
      return json({ ok: 1, request_id: id, nodes: NODES });
    }
    const result = /check-result\/([^/?]+)/.exec(url);
    if (result) {
      polls++;
      const body = ids.get(result[1]!)!;
      if (answers.pendingPolls && polls <= answers.pendingPolls * 3) {
        return json(Object.fromEntries(Object.keys(NODES).map((n) => [n, null])));
      }
      return json(body);
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, requests };
}
const sleep = async () => undefined;
/** A standard install (https on 443) on `host`, with voice on the same host, unless a test says otherwise. */
const std = (host: string, extra: Partial<ReachOptions> = {}): Omit<ReachOptions, 'fetchImpl'> => ({
  web: { host, scheme: 'https', port: 443 },
  voice: { host, port: 7881 },
  sleep,
  now: () => 0,
  ...extra,
});
const run = (host: string, f = fakeCheckHost(), extra: Partial<ReachOptions> = {}) =>
  checkReach({ ...std(host, extra), fetchImpl: f.fetchImpl });
const row = (rows: Awaited<ReturnType<typeof run>>, name: RegExp) =>
  rows.find((r) => name.test(r.name))!;

describe('reachTargets', () => {
  it('reads a standard https address: host, https, port 443, and voice on the same host', () => {
    expect(reachTargets('https://play.example.com', undefined)).toEqual({
      web: { host: 'play.example.com', scheme: 'https', port: 443 },
      voice: { host: 'play.example.com', port: 7881 },
    });
  });

  it('keeps a custom port, and the scheme of a plain-HTTP install', () => {
    expect(reachTargets('https://play.example.com:8443/x', undefined)?.web).toEqual({
      host: 'play.example.com',
      scheme: 'https',
      port: 8443,
    });
    expect(reachTargets('http://192.0.2.7', undefined)?.web).toEqual({
      host: '192.0.2.7',
      scheme: 'http',
      port: 80,
    });
    expect(reachTargets('http://play.example.com:8080', undefined)?.web.port).toBe(8080);
  });

  it('checks voice at its own address when the operator gave one (web behind Cloudflare, voice direct)', () => {
    expect(reachTargets('https://play.example.com', '203.0.113.9')?.voice).toEqual({
      host: '203.0.113.9',
      port: 7881,
    });
    expect(reachTargets('https://play.example.com', 'voice.example.com')?.voice.host).toBe(
      'voice.example.com',
    );
  });

  it('checks voice at the web host when the voice address is blank or auto', () => {
    expect(reachTargets('https://play.example.com', 'auto')?.voice.host).toBe('play.example.com');
    expect(reachTargets('https://play.example.com', '  ')?.voice.host).toBe('play.example.com');
  });

  it('takes the voice TCP port from the operator when they changed it', () => {
    expect(reachTargets('https://play.example.com', undefined, 7900)?.voice.port).toBe(7900);
  });

  it('has nothing for an address that is not set or not a web address', () => {
    expect(reachTargets(undefined, undefined)).toBeUndefined();
    expect(reachTargets('', undefined)).toBeUndefined();
    expect(reachTargets('not a url', undefined)).toBeUndefined();
    expect(reachTargets('ftp://x.example.com', undefined)).toBeUndefined();
  });
});

describe('checkReach: installs that are not the standard one', () => {
  const startedUrls = (f: ReturnType<typeof fakeCheckHost>) =>
    f.requests
      .filter((r) => /check-(http|tcp)\?/.test(r.url))
      .map((r) => decodeURIComponent(r.url));

  it('checks a custom port where it is, and does not check port 80 it never opened', async () => {
    const f = fakeCheckHost();
    const rows = await checkReach({
      ...std('play.example.com', {
        web: { host: 'play.example.com', scheme: 'https', port: 8443 },
      }),
      fetchImpl: f.fetchImpl,
    });
    const urls = startedUrls(f);
    expect(urls.some((u) => u.includes('https://play.example.com:8443/api/health'))).toBe(true);
    expect(urls.some((u) => u.includes('check-http?host=http://'))).toBe(false);
    expect(rows.find((r) => /8443/.test(r.name))?.badge).toBe('ok');
    expect(rows.find((r) => /HTTP \(80\)/.test(r.name))).toBeUndefined();
  });

  it('checks a plain-HTTP install on its own port', async () => {
    const f = fakeCheckHost();
    const rows = await checkReach({
      ...std('192.0.2.7', { web: { host: '192.0.2.7', scheme: 'http', port: 80 } }),
      fetchImpl: f.fetchImpl,
    });
    const urls = startedUrls(f);
    expect(urls.some((u) => u.includes('check-http?host=http://192.0.2.7/api/health'))).toBe(true);
    expect(rows.some((r) => /Web/.test(r.name) && r.badge === 'ok')).toBe(true);
  });

  it('checks the voice TCP port at the voice address, not the proxied web host', async () => {
    const f = fakeCheckHost();
    const rows = await checkReach({
      ...std('play.example.com', { voice: { host: '203.0.113.9', port: 7881 } }),
      fetchImpl: f.fetchImpl,
    });
    const urls = startedUrls(f);
    expect(urls.some((u) => u.includes('check-tcp?host=203.0.113.9:7881'))).toBe(true);
    expect(urls.some((u) => u.includes('check-tcp?host=play.example.com'))).toBe(false);
    expect(rows.find((r) => /7881/.test(r.name))?.name).toMatch(/203\.0\.113\.9/);
  });

  it('does not check voice on a private voice address, but still checks the web side', async () => {
    const f = fakeCheckHost();
    const rows = await checkReach({
      ...std('play.example.com', { voice: { host: '192.168.1.20', port: 7881 } }),
      fetchImpl: f.fetchImpl,
    });
    const voice = rows.find((r) => /Voice TCP/.test(r.name))!;
    expect(voice.badge).toBe('warn');
    expect(voice.detail).toMatch(/private|not a public/i);
    expect(rows.find((r) => /HTTPS/.test(r.name))?.badge).toBe('ok');
    expect(startedUrls(f).some((u) => u.includes('check-tcp'))).toBe(false);
  });

  it('tells a failed voice port that Cloudflare does not carry it, when voice shares the web host', async () => {
    const tcpFail = Object.fromEntries(
      Object.keys(NODES).map((n) => [n, [{ error: 'Connection timed out' }]]),
    );
    const r = (await run('play.example.com', fakeCheckHost({ tcp: tcpFail }))).find((x) =>
      /7881/.test(x.name),
    )!;
    expect(r.detail).toMatch(/Cloudflare/);
    expect(r.detail).toMatch(/voice-address/);
  });
});

describe('checkReach: a public server that works', () => {
  it('is ok on HTTP, HTTPS and the voice TCP port, and says what it saw and from where', async () => {
    const rows = await run('play.example.com');
    expect(row(rows, /HTTP \(80\)/).badge).toBe('ok');
    expect(row(rows, /HTTPS \(443\)/).badge).toBe('ok');
    expect(row(rows, /7881/).badge).toBe('ok');
    expect(row(rows, /HTTPS/).detail).toMatch(/3 of 3/);
    expect(row(rows, /HTTPS/).detail).toMatch(/Los Angeles/);
  });

  it('asks check-host.net about the right things, as JSON, and says who is asking', async () => {
    const f = fakeCheckHost();
    await run('play.example.com', f);
    const starts = f.requests
      .filter((r) => /check-(http|tcp)\?/.test(r.url))
      .map((r) => decodeURIComponent(r.url));
    expect(starts.some((u) => u.includes('check-http?host=http://play.example.com/'))).toBe(true);
    expect(
      starts.some((u) => u.includes('check-http?host=https://play.example.com/api/health')),
    ).toBe(true);
    expect(starts.some((u) => u.includes('check-tcp?host=play.example.com:7881'))).toBe(true);
    expect(f.requests[0]?.headers.Accept).toBe('application/json');
    expect(f.requests[0]?.headers['User-Agent']).toMatch(/vtt-chat/i);
  });

  it('never claims to have proved UDP: it cannot be checked from outside, and says how to', async () => {
    const udp = row(await run('play.example.com'), /UDP/);
    expect(udp.badge).toBe('off');
    expect(udp.detail).toMatch(/phone/i);
  });

  it('waits for slow nodes, then reports them', async () => {
    const rows = await run('play.example.com', fakeCheckHost({ pendingPolls: 2 }));
    expect(row(rows, /HTTPS/).badge).toBe('ok');
  });
});

describe('checkReach: when something is wrong', () => {
  const ALL_FAIL_HTTP = Object.fromEntries(
    Object.keys(NODES).map((n) => [n, [[0, 0.2, 'Connection refused', null, null]]]),
  );
  const ALL_FAIL_TCP = Object.fromEntries(
    Object.keys(NODES).map((n) => [n, [{ error: 'Connection timed out' }]]),
  );

  it('fails HTTPS when no place on earth could reach it', async () => {
    const rows = await run('play.example.com', fakeCheckHost({ https: ALL_FAIL_HTTP }));
    expect(row(rows, /HTTPS/).badge).toBe('fail');
    expect(row(rows, /HTTPS/).detail).toMatch(/0 of 3/);
  });

  it('only warns when some places reached it and others did not, and names the ones that did not', async () => {
    const some = {
      'us1.node.check-host.net': [[1, 0.1, 'OK', '200', '9.9.9.9']],
      'ch1.node.check-host.net': [[0, 0.2, 'Connection refused', null, null]],
      'pt1.node.check-host.net': [[1, 0.1, 'OK', '200', '9.9.9.9']],
    };
    const r = row(await run('play.example.com', fakeCheckHost({ https: some })), /HTTPS/);
    expect(r.badge).toBe('warn');
    expect(r.detail).toMatch(/2 of 3/);
    expect(r.detail).toMatch(/Zurich/);
  });

  it('treats a plain-HTTP redirect to HTTPS as working', async () => {
    const redirect = Object.fromEntries(
      Object.keys(NODES).map((n) => [n, [[1, 0.1, 'Moved Permanently', '301', '9.9.9.9']]]),
    );
    expect(
      row(await run('play.example.com', fakeCheckHost({ http: redirect })), /HTTP \(80\)/).badge,
    ).toBe('ok');
  });

  it('warns, never fails, when only the voice TCP fallback port is closed, and says what that costs', async () => {
    const r = row(await run('play.example.com', fakeCheckHost({ tcp: ALL_FAIL_TCP })), /7881/);
    expect(r.badge).toBe('warn');
    expect(r.detail).toMatch(/block UDP|restrictive/i);
  });

  it('warns that nothing could be checked, rather than failing the server, when check-host.net cannot be reached', async () => {
    const rows = await run('play.example.com', fakeCheckHost({ down: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ badge: 'warn' });
    expect(rows[0]?.detail).toMatch(/check-host\.net/);
  });

  it('warns when check-host.net refuses the request (a limit), and says to try later', async () => {
    const rows = await run('play.example.com', fakeCheckHost({ startOk: 0 }));
    expect(rows[0]?.badge).toBe('warn');
    expect(rows[0]?.detail).toMatch(/later/i);
  });

  it('says a check never answered, when it did not in time', async () => {
    const f = fakeCheckHost({ pendingPolls: 1000 });
    const rows = await checkReach({
      ...std('play.example.com', {
        now: (
          (t) => () =>
            (t += 5000)
        )(0),
        timeoutMs: 20_000,
      }),
      fetchImpl: f.fetchImpl,
    });
    expect(row(rows, /HTTPS/).detail).toMatch(/did not answer in time/i);
  });
});

describe('checkReach: an address nothing outside can reach', () => {
  it.each(['localhost', '192.168.1.20', '10.0.0.5', '172.16.4.2', 'vtt.local', '127.0.0.1'])(
    'does not ask anyone about %s',
    async (host) => {
      const f = fakeCheckHost();
      const rows = await run(host, f);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.badge).toBe('warn');
      expect(rows[0]?.detail).toMatch(/not a public address|private/i);
      expect(f.requests).toHaveLength(0);
    },
  );
});
