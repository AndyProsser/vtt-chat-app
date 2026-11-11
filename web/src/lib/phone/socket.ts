import type { LiveState } from '../../types/phone.js';

/** Just enough of the browser's WebSocket for this class, so a test can stand in for it. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface LiveSocketOptions {
  url: string;
  campaignId: string;
  /** Every server frame after sign-in: its type and data. */
  onEvent: (type: string, data: unknown) => void;
  onState: (state: LiveState) => void;
  /** The server ended this sign-in (signed out elsewhere, or expired). */
  onRevoked: () => void;
  open?: (url: string) => SocketLike;
  /** Waits before a reconnect; tests pass their own. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const OPEN = 1;
const PROTOCOL_VERSION = 1;
export const RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/**
 * The phone's live connection: wait to be signed in by the cookie, subscribe to one campaign, hand every event to the caller, and
 * come back by itself after a drop. It always asks for a fresh snapshot rather than replaying a gap,
 * because a phone is often asleep for minutes and the snapshot carries the recent chat anyway.
 */
export class LiveSocket {
  private socket: SocketLike | undefined;
  private attempt = 0;
  private timer: unknown;
  private stopped = false;
  private nextId = 0;

  constructor(private readonly o: LiveSocketOptions) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) (this.o.cancel ?? clearTimeout)(this.timer as never);
    this.timer = undefined;
    const s = this.socket;
    this.socket = undefined;
    if (s) {
      s.onclose = null;
      s.close();
    }
  }

  /** Sends a chat line; false when the connection is not up (the caller keeps the text). */
  say(text: string, to?: string): boolean {
    return this.send('chat.message', {
      campaignId: this.o.campaignId,
      text,
      ...(to === undefined ? {} : { to }),
    });
  }

  private send(t: string, d: unknown): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify({ v: PROTOCOL_VERSION, t, id: `m${++this.nextId}`, d }));
    return true;
  }

  private connect(): void {
    this.o.onState('connecting');
    const socket = (this.o.open ?? ((url) => new WebSocket(url) as unknown as SocketLike))(
      this.o.url,
    );
    this.socket = socket;
    // No `auth` frame: the browser's session cookie went with the upgrade request (which the server only
    // honours from this site's own pages) and the server signs the connection in itself.
    socket.onopen = () => undefined;
    socket.onmessage = (event) => {
      let frame: { t?: unknown; d?: unknown };
      try {
        frame = JSON.parse(String(event.data)) as { t?: unknown; d?: unknown };
      } catch {
        return;
      }
      if (typeof frame.t !== 'string') return;
      if (frame.t === 'auth.ok') {
        this.attempt = 0;
        this.send('resume', { campaignId: this.o.campaignId });
        this.o.onState('live');
        return;
      }
      if (frame.t === 'auth.revoked') {
        this.stopped = true;
        this.o.onRevoked();
        return;
      }
      this.o.onEvent(frame.t, frame.d);
    };
    const lost = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.o.onState('offline');
      if (this.stopped) return;
      const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)] ?? 30_000;
      this.attempt += 1;
      this.timer = (this.o.schedule ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
        this.timer = undefined;
        if (!this.stopped) this.connect();
      }, wait);
    };
    socket.onclose = lost;
    socket.onerror = () => undefined; // a failed connect is followed by close, which retries
  }
}

/** `wss://host/ws` for an https page, `ws://host/ws` for http. */
export const socketUrl = (loc: { protocol: string; host: string }): string =>
  `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
