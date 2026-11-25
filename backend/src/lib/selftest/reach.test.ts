import { describe, expect, it } from 'vitest';

import { checkReach, reachHost } from './reach.js';

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
const run = (host: string, f = fakeCheckHost(), extra: object = {}) =>
  checkReach({ host, fetchImpl: f.fetchImpl, sleep, now: () => 0, ...extra });
const row = (rows: Awaited<ReturnType<typeof run>>, name: RegExp) =>
  rows.find((r) => name.test(r.name))!;

describe('reachHost', () => {
  it('takes the host name out of the server’s public address', () => {
    expect(reachHost('https://play.example.com')).toBe('play.example.com');
    expect(reachHost('https://play.example.com/path?x=1')).toBe('play.example.com');
    expect(reachHost('http://play.example.com:8443')).toBe('play.example.com');
  });

  it('has nothing for an address that is not set or not a web address', () => {
    expect(reachHost(undefined)).toBeUndefined();
    expect(reachHost('')).toBeUndefined();
    expect(reachHost('not a url')).toBeUndefined();
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
      host: 'play.example.com',
      fetchImpl: f.fetchImpl,
      sleep,
      now: (
        (t) => () =>
          (t += 5000)
      )(0),
      timeoutMs: 20_000,
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
