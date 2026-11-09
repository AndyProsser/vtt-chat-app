import { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import type { DdbSyncService } from '../ddb/ddbSyncService.js';
import { DomainError } from '../errors.js';
import { authOf, requireAuth } from './middleware.js';

export interface DdbRouteDeps {
  accounts: AccountService;
  ddb?: DdbSyncService;
}

const target = z.object({ campaignId: z.string().max(64), characterId: z.string().max(64) });
const linkBody = target.extend({ url: z.string().max(2048) });

/**
 * Mounted at `/api/ddb`. `GET /status` always answers, so the app knows whether to show the link
 * controls; the rest need the operator to have switched the sync on.
 */
export function ddbRoutes({ accounts, ddb }: DdbRouteDeps): Router {
  const router = Router();
  router.use(requireAuth(accounts));

  router.get('/status', (_req, res) => {
    res.json({ enabled: ddb?.enabled === true });
  });

  router.post('/link', async (req, res) => {
    const body = linkBody.parse(req.body);
    const character = await need(ddb).link(
      authOf(res).user,
      body.campaignId,
      body.characterId,
      body.url,
    );
    res.json({ character });
  });

  router.post('/sync', async (req, res) => {
    const body = target.parse(req.body);
    const character = await need(ddb).syncNow(authOf(res).user, body.campaignId, body.characterId);
    res.json({ character });
  });

  router.post('/unlink', async (req, res) => {
    const body = target.parse(req.body);
    const character = await need(ddb).unlink(authOf(res).user, body.campaignId, body.characterId);
    res.json({ character });
  });

  return router;
}

function need(ddb: DdbSyncService | undefined): DdbSyncService {
  if (!ddb?.enabled)
    throw new DomainError('not_found', 'D&D Beyond sync is not enabled on this server');
  return ddb;
}
