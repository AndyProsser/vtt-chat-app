import express, { type Express } from 'express';

import type { BackendConfig } from './config.js';

/**
 * Stage 1 skeleton. The previous `POST /api/session` (which trusted a D&D Beyond identity) is
 * gone; accounts, campaigns and the WebSocket layer arrive in ROADMAP Stage 3. LiveKit token
 * issuance is kept in `session/liveKitToken.ts` for that stage to wire behind real auth.
 */
export function createApp(_config: BackendConfig): Express {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
