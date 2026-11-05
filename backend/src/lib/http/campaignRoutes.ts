import { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import type { CampaignService } from '../campaigns/campaignService.js';
import { DomainError } from '../errors.js';
import { mintLiveKitToken } from '../session/liveKitToken.js';
import type { Store } from '../store/store.js';
import { authOf, requireAuth } from './middleware.js';
import type { RateLimiter } from './rateLimit.js';

const createBody = z.object({ name: z.string().max(200) });
const inviteBody = z.object({ expiresInDays: z.number().positive().max(365).optional() });
const joinBody = z.object({ code: z.string().max(64) });
const characterBody = z.object({
  name: z.string().max(200),
  className: z.string().max(80).nullable().default(null),
  race: z.string().max(80).nullable().default(null),
  level: z.number().int().min(1).max(30).nullable().default(null),
  avatarUrl: z.string().url().max(2048).nullable().default(null),
  sourceUrl: z.string().url().max(2048).nullable().default(null),
});
const activeBody = z.object({ characterId: z.string().max(64) });
const swapBody = z.object({ newDmUserId: z.string().max(64) });

export interface CampaignRouteDeps {
  accounts: AccountService;
  campaigns: CampaignService;
  store: Store;
  liveKit: { url: string; apiKey: string; apiSecret: string };
  /** Slows guessing of invite codes. Keyed by client address. */
  inviteLimiter: RateLimiter;
  /** Called when roles, members or characters change, so live clients can refresh. */
  onRosterChanged?: (campaignId: string) => void;
}

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

export function campaignRoutes(deps: CampaignRouteDeps): Router {
  const { campaigns, store, liveKit, inviteLimiter, onRosterChanged } = deps;
  const router = Router();
  router.use(requireAuth(deps.accounts));

  router.get('/', async (_req, res) => {
    const memberships = await store.listMembershipsForUser(authOf(res).user.id);
    const items = [];
    for (const membership of memberships) {
      const campaign = await store.getCampaign(membership.campaignId);
      if (campaign) items.push({ campaign, role: membership.role });
    }
    res.json({ campaigns: items });
  });

  router.post('/', async (req, res) => {
    const body = createBody.parse(req.body);
    const campaign = await campaigns.createCampaign(authOf(res).user, body.name);
    res.status(201).json({ campaign });
  });

  // Joining is by invite code (emailed link, side channel or QR all carry the same code).
  router.post('/join', async (req, res) => {
    const body = joinBody.parse(req.body);
    if (!inviteLimiter.allow(`invite:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many attempts; try again later' });
      return;
    }
    const membership = await campaigns.joinWithInvite(authOf(res).user, body.code);
    onRosterChanged?.(membership.campaignId);
    res.status(201).json({ membership });
  });

  router.get('/:id/members', async (req, res) => {
    const members = await campaigns.listMembers(authOf(res).user, param(req.params.id));
    res.json({ members });
  });

  router.post('/:id/invites', async (req, res) => {
    const body = inviteBody.parse(req.body ?? {});
    const options = body.expiresInDays === undefined ? {} : { expiresInDays: body.expiresInDays };
    const { invite, code } = await campaigns.createInvite(
      authOf(res).user,
      param(req.params.id),
      options,
    );
    // The only time the code is ever shown; only its hash is stored.
    res.status(201).json({ code, expiresAt: invite.expiresAt });
  });

  router.delete('/:id/invites/:code', async (req, res) => {
    await campaigns.revokeInvite(authOf(res).user, param(req.params.id), param(req.params.code));
    res.status(204).end();
  });

  router.post('/:id/characters', async (req, res) => {
    const body = characterBody.parse(req.body);
    const campaignId = param(req.params.id);
    const character = await campaigns.addCharacter(authOf(res).user, campaignId, body);
    onRosterChanged?.(campaignId);
    res.status(201).json({ character });
  });

  router.put('/:id/active-character', async (req, res) => {
    const body = activeBody.parse(req.body);
    const membership = await campaigns.setActiveCharacter(
      authOf(res).user,
      param(req.params.id),
      body.characterId,
    );
    res.json({ membership });
  });

  // The DM and a player swap places in one request.
  router.post('/:id/dm-swap', async (req, res) => {
    const body = swapBody.parse(req.body);
    const campaignId = param(req.params.id);
    await campaigns.swapDm(authOf(res).user, campaignId, body.newDmUserId);
    onRosterChanged?.(campaignId);
    res.status(204).end();
  });

  router.post('/:id/leave', async (req, res) => {
    const campaignId = param(req.params.id);
    await campaigns.leaveCampaign(authOf(res).user, campaignId);
    onRosterChanged?.(campaignId);
    res.status(204).end();
  });

  // Voice access follows membership: a LiveKit token is issued only to members, for that
  // campaign's room only. The name shown to others is the active character's, else the account's.
  router.post('/:id/voice-token', async (req, res) => {
    const { user } = authOf(res);
    const campaignId = param(req.params.id);
    const membership = await store.getMembership(campaignId, user.id);
    if (!membership) throw new DomainError('forbidden', 'not a member of this campaign');

    const character = membership.activeCharacterId
      ? await store.getCharacter(membership.activeCharacterId)
      : undefined;
    const token = await mintLiveKitToken({
      apiKey: liveKit.apiKey,
      apiSecret: liveKit.apiSecret,
      identity: user.id,
      roomName: campaignId,
      name: character?.name ?? user.displayName,
    });
    res.json({ url: liveKit.url, token, roomName: campaignId });
  });

  return router;
}
