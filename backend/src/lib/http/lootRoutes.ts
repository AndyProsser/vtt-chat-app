import { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import type { LootService } from '../table/lootService.js';
import type { LootItem } from '../table/tableStore.js';
import { isItemType, isRarity, type ItemType, type Rarity } from '@vtt-chat-app/shared';
import { authOf, requireAuth } from './middleware.js';

export interface LootRouteDeps {
  accounts: AccountService;
  loot: LootService;
  /** Live notification: an item was dropped, claimed or removed. */
  onChange?: (event: 'dropped' | 'claimed' | 'removed', item: LootItem) => void;
}

const dropBody = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  kind: z.enum(['item', 'coin']).optional(),
  itemType: z.string().max(40).optional(),
  rarity: z.string().max(40).nullable().optional(),
  srdId: z.string().max(100).optional(),
});
const batchBody = z.object({ items: z.array(dropBody).max(50) });
// A POST (a read-only search) so the tray app's REST relay, which refuses query strings, can reach it.
const catalogQuery = z.object({
  q: z.string().max(100).optional(),
  type: z.string().max(40).optional(),
  rarity: z.string().max(40).optional(),
  magic: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
const rollBody = z.object({
  cr: z.number().min(0).max(30),
  kind: z.enum(['individual', 'hoard']),
});
const draftBody = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(['item', 'coin']),
  quantity: z.number().int().min(1).max(100_000),
  description: z.string().max(2000).optional(),
  itemType: z.string().max(40),
  rarity: z.string().max(40).nullable(),
  srdId: z.string().max(100).optional(),
});
const rerollBody = z.object({ cr: z.number().min(0).max(30), draft: draftBody });
const claimBody = z.object({ for: z.enum(['self', 'party']).optional() });
const splitBody = z.object({ userIds: z.array(z.string().max(64)).optional() });

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

  router.post('/catalog', async (req, res) => {
    const q = catalogQuery.parse(req.body ?? {});
    if (q.type !== undefined && !isItemType(q.type))
      throw new DomainError('invalid_input', 'unknown item type');
    if (q.rarity !== undefined && !isRarity(q.rarity))
      throw new DomainError('invalid_input', 'unknown rarity');
    const items = await loot.catalog(authOf(res).user, campaign(req), {
      ...(q.q !== undefined ? { query: q.q } : {}),
      ...(q.type !== undefined ? { type: q.type as ItemType } : {}),
      ...(q.rarity !== undefined ? { rarity: q.rarity as Rarity } : {}),
      ...(q.magic !== undefined ? { magic: q.magic } : {}),
      limit: q.limit,
    });
    res.json({ items });
  });

  router.post('/roll', async (req, res) => {
    const body = rollBody.parse(req.body);
    res.json({ drafts: await loot.roll(authOf(res).user, campaign(req), body) });
  });

  router.post('/roll/reroll', async (req, res) => {
    const body = rerollBody.parse(req.body);
    const draft = await loot.rerollEntry(authOf(res).user, campaign(req), body.cr, {
      ...body.draft,
      itemType: body.draft.itemType as ItemType,
      rarity: body.draft.rarity as Rarity | null,
    });
    res.json({ draft });
  });

  router.post('/batch', async (req, res) => {
    const body = batchBody.parse(req.body);
    const items = await loot.dropMany(authOf(res).user, campaign(req), body.items);
    for (const item of items) deps.onChange?.('dropped', item);
    res.status(201).json({ items });
  });

  router.post('/', async (req, res) => {
    const body = dropBody.parse(req.body);
    const item = await loot.drop(authOf(res).user, campaign(req), body);
    deps.onChange?.('dropped', item);
    res.status(201).json({ item });
  });

  router.post('/:itemId/claim', async (req, res) => {
    const body = claimBody.parse(req.body ?? {});
    const item = await loot.claim(
      authOf(res).user,
      campaign(req),
      param(req.params.itemId),
      body.for,
    );
    deps.onChange?.('claimed', item);
    res.json({ item });
  });

  router.post('/:itemId/assign', async (req, res) => {
    const body = z.object({ userId: z.string().min(1).max(64) }).parse(req.body);
    const item = await loot.assign(
      authOf(res).user,
      campaign(req),
      param(req.params.itemId),
      body.userId,
    );
    deps.onChange?.('claimed', item);
    res.json({ item });
  });

  router.post('/:itemId/split', async (req, res) => {
    const body = splitBody.parse(req.body ?? {});
    const item = await loot.split(
      authOf(res).user,
      campaign(req),
      param(req.params.itemId),
      body.userIds,
    );
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
