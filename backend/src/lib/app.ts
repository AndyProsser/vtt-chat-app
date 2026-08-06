import { sessionRequestSchema, type SessionResponse } from '@vtt-chat-app/shared';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { BackendConfig } from './config.js';
import { issueAppSessionToken, mintLiveKitToken } from './session/index.js';

export function createApp(config: BackendConfig): Express {
  const app = express();
  app.use(express.json());

  app.post('/api/session', (req, res, next) => {
    const parsed = sessionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid session request', issues: parsed.error.issues });
      return;
    }

    const { identity } = parsed.data;

    Promise.all([
      issueAppSessionToken(
        { ddbUserId: identity.ddbUserId, campaignId: identity.campaign.id, isDm: identity.isDm },
        config.appJwtSecret,
      ),
      mintLiveKitToken({
        apiKey: config.liveKitApiKey,
        apiSecret: config.liveKitApiSecret,
        identity: identity.ddbUserId,
        roomName: identity.campaign.id,
      }),
    ])
      .then(([appSessionToken, liveKitToken]) => {
        const response: SessionResponse = {
          appSessionToken,
          liveKit: { url: config.liveKitUrl, token: liveKitToken, roomName: identity.campaign.id },
        };
        res.status(200).json(response);
      })
      .catch((error: unknown) => {
        next(error instanceof Error ? error : new Error('unknown error during session issuance'));
      });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(502).json({ error: `session issuance failed: ${error.message}` });
  });

  return app;
}
