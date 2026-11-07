import { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import type { LootService } from '../table/lootService.js';
import type { LootItem } from '../table/tableStore.js';
import { authOf, requireAuth } from './middleware.js';

export interface LootRouteDeps {
  accounts: AccountService;
  loot: LootService;
  /** Live notification: an item was dropped, claimed or removed. */
  onChange?: (event: 'dropped' | 'claimed' | 'removed', item: LootItem) => void;
}

const dropBody = z.object({
  name: z.string().max(200),
  description: z.string().max(2000).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
});

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

/** Mounted at `/api/campaigns/:campaignId/loot`. */
export function lootRoutes(deps: LootRouteDeps): Router {
  const { loot } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps.accounts));
  const campaign = (req: { params: object }): string =>
    param((req.params as { campaignId?: string }).campaignId);

  router.get('/', async (req, res) => {
    res.json({ loot: await loot.list(authOf(res).user, campaign(req)) });
  });

  router.post('/', async (req, res) => {
    const body = dropBody.parse(req.body);
    const item = await loot.drop(authOf(res).user, campaign(req), body);
    deps.onChange?.('dropped', item);
    res.status(201).json({ item });
  });

  router.post('/:itemId/claim', async (req, res) => {
    const item = await loot.claim(authOf(res).user, campaign(req), param(req.params.itemId));
    deps.onChange?.('claimed', item);
    res.json({ item });
  });

  router.delete('/:itemId', async (req, res) => {
    const item = await loot.remove(authOf(res).user, campaign(req), param(req.params.itemId));
    deps.onChange?.('removed', item);
    res.status(204).end();
  });

  return router;
}
