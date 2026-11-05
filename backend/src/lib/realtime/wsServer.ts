import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

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
export function attachWebSocketServer(server: Server, hub: Hub): WsHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws: WebSocket) => {
    const connection: Connection = {
      id: randomUUID(),
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
