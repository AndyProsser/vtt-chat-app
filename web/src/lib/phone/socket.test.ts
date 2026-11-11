import { describe, expect, it } from 'vitest';

import { LiveSocket, RETRY_MS, socketUrl, type SocketLike } from './socket.js';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: { t: string; d: unknown }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(t: string, d?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, t, d }) });
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const waits: { fn: () => void; ms: number }[] = [];
  const events: [string, unknown][] = [];
  const states: string[] = [];
  let revoked = 0;
  const live = new LiveSocket({
    url: 'ws://x/ws',
    campaignId: 'c1',
    onEvent: (t, d) => events.push([t, d]),
    onState: (s) => states.push(s),
    onRevoked: () => (revoked += 1),
    open: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    schedule: (fn, ms) => waits.push({ fn, ms }),
    cancel: () => undefined,
  });
  return { live, sockets, waits, events, states, revoked: () => revoked };
}

describe('LiveSocket', () => {
  it('waits for the cookie sign-in (no auth frame), then asks for the campaign, and reports live', () => {
    const t = setup();
    t.live.start();
    const s = t.sockets[0]!;
    s.open();
    expect(s.sent).toEqual([]);
    s.say('auth.ok', { userId: 'u' });
    expect(s.sent[0]).toMatchObject({ t: 'resume', d: { campaignId: 'c1' } });
    expect(t.states).toEqual(['connecting', 'live']);
  });
  it('hands every later frame to the caller', () => {
    const t = setup();
    t.live.start();
    const s = t.sockets[0]!;
    s.open();
    s.say('auth.ok');
    s.say('chat.message', { text: 'hi' });
    expect(t.events).toEqual([['chat.message', { text: 'hi' }]]);
  });
  it('sends chat and whispers only while it is up', () => {
    const t = setup();
    t.live.start();
    const s = t.sockets[0]!;
    expect(t.live.say('too early')).toBe(false);
    s.open();
    s.say('auth.ok');
    expect(t.live.say('hello')).toBe(true);
    expect(t.live.say('psst', { to: 'u2' })).toBe(true);
    expect(s.sent.at(-2)).toMatchObject({
      t: 'chat.message',
      d: { campaignId: 'c1', text: 'hello' },
    });
    expect(s.sent.at(-1)).toMatchObject({ d: { to: 'u2', text: 'psst' } });
  });
  it('carries kind and lang, and leaves them off an ordinary line', () => {
    const t = setup();
    t.live.start();
    const s = t.sockets[0]!;
    s.open();
    s.say('auth.ok');
    t.live.say('hi', { kind: 'chat' });
    expect(s.sent.at(-1)?.d).toEqual({ campaignId: 'c1', text: 'hi' });
    t.live.say('Hail', { kind: 'say', lang: 'elvish' });
    expect(s.sent.at(-1)?.d).toEqual({
      campaignId: 'c1',
      text: 'Hail',
      kind: 'say',
      lang: 'elvish',
    });
  });
  it('reconnects after a drop, waiting longer each time, and starts over once signed in', () => {
    const t = setup();
    t.live.start();
    t.sockets[0]!.drop();
    expect(t.states.at(-1)).toBe('offline');
    expect(t.waits[0]?.ms).toBe(RETRY_MS[0]);
    t.waits[0]!.fn();
    t.sockets[1]!.drop();
    expect(t.waits[1]?.ms).toBe(RETRY_MS[1]);
    t.waits[1]!.fn();
    t.sockets[2]!.open();
    t.sockets[2]!.say('auth.ok');
    t.sockets[2]!.drop();
    expect(t.waits[2]?.ms).toBe(RETRY_MS[0]);
  });
  it('stops for good when the sign-in is revoked', () => {
    const t = setup();
    t.live.start();
    const s = t.sockets[0]!;
    s.open();
    s.say('auth.revoked', { code: 'unauthorized' });
    expect(t.revoked()).toBe(1);
    s.drop();
    expect(t.waits).toHaveLength(0);
  });
  it('does not reconnect after stop()', () => {
    const t = setup();
    t.live.start();
    t.live.stop();
    expect(t.waits).toHaveLength(0);
    expect(t.sockets[0]?.readyState).toBe(3);
  });
  it('builds the socket address from the page address', () => {
    expect(socketUrl({ protocol: 'https:', host: 'vtt.example.com' })).toBe(
      'wss://vtt.example.com/ws',
    );
    expect(socketUrl({ protocol: 'http:', host: 'localhost:3000' })).toBe('ws://localhost:3000/ws');
  });
});
