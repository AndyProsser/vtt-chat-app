import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

import { readCookie, sameOrigin, PLAIN_COOKIE, SECURE_COOKIE } from '../http/sessionCookie.js';
import type { Connection, Hub } from './hub.js';

export const WS_PATH = '/ws';
/** Largest accepted frame. Chat is capped at 4,000 characters; nothing legitimate is near this. */
const MAX_PAYLOAD_BYTES = 64 * 1024;
const HEARTBEAT_MS = 30_000;
/** Re-validate every open session this often (revocation, offline limit) and refresh "last seen". */
const RECHECK_MS = 5 * 60_000;

export interface WsHandle {
  close(): Promise<void>;
}

/**
 * Binds the transport-agnostic `Hub` to real WebSockets on `/ws`. All the rules live in the hub;
 * this only moves bytes, keeps connections honest with ping/pong, and periodically re-checks
 * sessions so a remote sign-out takes effect on a socket that is already open.
 */
export interface WsOptions {
  /**
   * Whether `X-Forwarded-*` headers from this peer address can be believed (the app's `trust proxy`
   * setting). Only used to work out the page origin and scheme when the browser session cookie is the
   * credential. Default: never.
   */
  trustProxy?: (peerAddress: string) => boolean;
}

/**
 * The session token in the browser's cookie, if there is one and the upgrade came from this server's own
 * pages. A cookie rides along on every WebSocket handshake, including one opened by another site's script,
 * so the `Origin` must match; an absent or foreign Origin means the cookie is ignored (and the client has
 * to send an `auth` frame, which a cross-site page has no token for).
 */
function cookieCredential(
  request: IncomingMessage,
  trusted: boolean,
): { credential: string | undefined; ownPage: boolean } {
  const forwarded = (name: string): string | undefined =>
    trusted ? (request.headers[name] as string | undefined)?.split(',')[0]?.trim() : undefined;
  const secure =
    (request.socket as { encrypted?: boolean }).encrypted === true ||
    forwarded('x-forwarded-proto') === 'https';
  const host = forwarded('x-forwarded-host') ?? request.headers.host;
  const raw = readCookie(request.headers.cookie, secure ? SECURE_COOKIE : PLAIN_COOKIE);
  if (!host) return { credential: undefined, ownPage: false };
  // A WebSocket handshake is a GET, so `sameOrigin` would wave it through; ask it as a POST. A request that
  // names an Origin and passes is one of this server's own pages (the desktop app sends no Origin).
  const expected = `${secure ? 'https' : 'http'}://${host}`;
  const ownPage =
    request.headers.origin !== undefined &&
    sameOrigin('POST', request.headers.origin, undefined, expected);
  if (raw === undefined || !ownPage) return { credential: undefined, ownPage };
  try {
    return { credential: decodeURIComponent(raw), ownPage };
  } catch {
    return { credential: undefined, ownPage };
  }
}

/** Refuses a WebSocket upgrade the way an HTTP server refuses any request: before there is a socket at all. */
function refuse(socket: Duplex): void {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  socket.destroy();
}

export function attachWebSocketServer(server: Server, hub: Hub, options: WsOptions = {}): WsHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();
  const credentials = new WeakMap<IncomingMessage, string>();

  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== WS_PATH) {
      socket.destroy();
      return;
    }
    const trusted = options.trustProxy?.(request.socket.remoteAddress ?? '') ?? false;
    const { credential, ownPage } = cookieCredential(request, trusted);
    const upgrade = (): void => {
      if (credential) credentials.set(request, credential);
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    };
    // One of our own pages relies on its cookie alone (it has no token to send in an `auth` frame), so no
    // cookie, or a dead one, can never succeed: answer 401 instead of letting it connect, time out and retry.
    if (ownPage && !credential) return refuse(socket);
    if (!credential) return upgrade();
    hub.credentialValid(credential).then(
      (valid) => (valid ? upgrade() : refuse(socket)),
      () => socket.destroy(),
    );
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const credential = credentials.get(request);
    const connection: Connection = {
      id: randomUUID(),
      ...(credential ? { credential } : {}),
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason),
    };
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    hub.accept(connection);

    ws.on('message', (data, isBinary) => {
      // The protocol is text-only JSON; a binary frame is a bug or an attack, and is ignored.
      if (isBinary) return;
      void hub.receive(connection.id, data.toString('utf8'));
    });
    ws.on('close', () => hub.closed(connection.id));
    ws.on('error', () => hub.closed(connection.id));
  });

  // Half-open connections (a laptop that slept, a NAT that dropped the mapping) never send a close.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  const recheck = setInterval(() => {
    hub.recheckSessions().catch((error: unknown) => {
      console.error('[realtime] session recheck failed', error);
    });
  }, RECHECK_MS);

  // Don't let these timers keep the process alive on shutdown.
  heartbeat.unref();
  recheck.unref();

  return {
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        clearInterval(recheck);
        for (const ws of wss.clients) ws.terminate();
        hub.close();
        wss.close(() => resolve());
      }),
  };
}
