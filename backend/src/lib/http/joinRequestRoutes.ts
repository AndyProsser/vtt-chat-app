import { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import type { JoinRequestService } from '../campaigns/joinRequests.js';
import { DomainError } from '../errors.js';
import { authOf, requireAuth } from './middleware.js';
import type { RateLimiter } from './rateLimit.js';

const requestBody = z.object({ message: z.string().max(2000).optional() });
const decisionBody = z.object({ approve: z.boolean() });
const settingsBody = z.object({ allowJoin: z.boolean() });

export interface JoinRequestRouteDeps {
  accounts: AccountService;
  joins: JoinRequestService;
  /** Per client address, so the directory cannot be used to spam DMs. */
  requestLimiter: RateLimiter;
}

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

/**
 * Asking to join a campaign (docs/architecture/CAMPAIGN-JOIN-REQUESTS.md). Mounted at `/api/campaigns`
 * ahead of the other campaign routes; authentication is per route so unrelated paths fall through untouched.
 */
export function joinRequestRoutes({
  accounts,
  joins,
  requestLimiter,
}: JoinRequestRouteDeps): Router {
  const router = Router();
  const auth = requireAuth(accounts);

  router.get('/open', auth, async (_req, res) => {
    res.json({ campaigns: await joins.listOpen(authOf(res).user.id) });
  });

  router.post('/:id/join-requests', auth, async (req, res) => {
    const body = requestBody.parse(req.body ?? {});
    if (!requestLimiter.allow(`join-request:${req.ip}`)) {
      res
        .status(429)
        .json({ error: 'rate_limited', message: 'too many requests; try again later' });
      return;
    }
    res.status(202).json(await joins.request(authOf(res).user, param(req.params.id), body.message));
  });

  router.delete('/:id/join-requests/mine', auth, async (req, res) => {
    await joins.withdraw(authOf(res).user, param(req.params.id));
    res.status(204).end();
  });

  router.get('/:id/join-requests', auth, async (req, res) => {
    res.json(await joins.listForDm(param(req.params.id), authOf(res).user.id));
  });

  router.post('/:id/join-requests/:requestId/decision', auth, async (req, res) => {
    const body = decisionBody.parse(req.body);
    const { request, joined } = await joins.decide(
      param(req.params.id),
      param(req.params.requestId),
      authOf(res).user.id,
      body.approve,
    );
    res.json({ request: { id: request.id, status: request.status }, joined });
  });

  // The DM's Allow-join switch (the campaign's settings update).
  router.patch('/:id', auth, async (req, res) => {
    const body = settingsBody.parse(req.body);
    const campaign = await joins.setAllowJoin(
      param(req.params.id),
      authOf(res).user.id,
      body.allowJoin,
    );
    res.json({ campaign });
  });

  return router;
}
