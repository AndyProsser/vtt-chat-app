import { readFileSync } from 'node:fs';

import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '@vtt-chat-app/shared';
import type { RequestHandler, Router } from 'express';
import { Router as makeRouter } from 'express';

/**
 * The server's release version. The container image bakes it in as `VTT_VERSION` (one version covers server
 * and client); outside an image it falls back to the backend package's own version.
 */
export function serverVersion(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VTT_VERSION) return env.VTT_VERSION;
  try {
    const url = new URL('../../package.json', import.meta.url);
    return (JSON.parse(readFileSync(url, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

/**
 * Refuses an app whose protocol differs from ours with `426 Upgrade Required` and a body the app turns into
 * "update required". Requests without the header (the browser pages, the admin CLI) are not the desktop app and
 * are always served: the pages come from this same server, so they match by construction.
 */
export function protocolGate(version: string): RequestHandler {
  return (req, res, next) => {
    const sent = req.header(PROTOCOL_HEADER);
    if (sent === undefined || sent === String(PROTOCOL_VERSION)) return next();
    res.status(426).json({
      error: 'update_required',
      message: 'This server and your app speak different versions. Update the app to continue.',
      serverVersion: version,
      serverProtocol: PROTOCOL_VERSION,
      clientProtocol: sent,
    });
  };
}

/** `GET /api/version`: what the app (and an operator's curl) reads to see what this server is. */
export function versionRoutes(version: string): Router {
  const router = makeRouter();
  router.get('/', (_req, res) => {
    res.json({ version, protocol: PROTOCOL_VERSION });
  });
  return router;
}
