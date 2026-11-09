import { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import { notificationView } from '../schedule/relay.js';
import type { ScheduleService } from '../schedule/scheduleService.js';
import { authOf, requireAuth } from './middleware.js';

export interface ScheduleRouteDeps {
  accounts: AccountService;
  schedule: ScheduleService;
}

const createBody = z.object({
  startsAt: z.number().int().positive(),
  durationMinutes: z.number().optional(),
  title: z.string().max(200),
  notes: z.string().max(2000).optional(),
});
const patchBody = z.object({
  startsAt: z.number().int().positive().optional(),
  durationMinutes: z.number().optional(),
  title: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
const rsvpBody = z.object({ status: z.enum(['yes', 'late', 'no']) });
const listQuery = z.object({
  unread: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

/** Mounted at `/api/campaigns/:campaignId/sessions`. */
export function sessionRoutes(deps: ScheduleRouteDeps): Router {
  const { schedule } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps.accounts));
  const campaign = (req: { params: object }): string =>
    param((req.params as { campaignId?: string }).campaignId);

  router.get('/', async (req, res) => {
    res.json({ sessions: await schedule.list(authOf(res).user, campaign(req)) });
  });
  // Every session, however old: the "show previous sessions" view. A path rather than a query string
  // because the desktop app's relay only forwards plain path segments.
  router.get('/past', async (req, res) => {
    res.json({
      sessions: await schedule.list(authOf(res).user, campaign(req), { includePast: true }),
    });
  });
  router.post('/', async (req, res) => {
    const session = await schedule.create(
      authOf(res).user,
      campaign(req),
      createBody.parse(req.body),
    );
    res.status(201).json({ session });
  });
  router.patch('/:sessionId', async (req, res) => {
    const body = patchBody.parse(req.body);
    const patch = {
      ...(body.startsAt !== undefined ? { startsAt: body.startsAt } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    };
    res.json({
      session: await schedule.update(
        authOf(res).user,
        campaign(req),
        param(req.params.sessionId),
        patch,
      ),
    });
  });
  router.delete('/:sessionId', async (req, res) => {
    await schedule.cancel(authOf(res).user, campaign(req), param(req.params.sessionId));
    res.status(204).end();
  });
  router.put('/:sessionId/rsvp', async (req, res) => {
    const { status } = rsvpBody.parse(req.body);
    res.json(
      await schedule.rsvp(authOf(res).user, campaign(req), param(req.params.sessionId), status),
    );
  });
  return router;
}

/** Mounted at `/api/notifications`: the signed-in person's own, and only theirs. */
export function notificationRoutes(deps: ScheduleRouteDeps): Router {
  const { schedule } = deps;
  const router = Router();
  router.use(requireAuth(deps.accounts));

  router.get('/', async (req, res) => {
    const q = listQuery.parse(req.query);
    const list = await schedule.listNotifications(authOf(res).user, {
      unreadOnly: q.unread !== undefined,
      limit: q.limit,
    });
    res.json({
      notifications: list.map((n) => ({ ...notificationView(n), read: n.readAt !== null })),
    });
  });
  router.post('/read-all', async (_req, res) => {
    res.json({ marked: await schedule.markAllRead(authOf(res).user) });
  });
  router.post('/:id/read', async (req, res) => {
    if (!(await schedule.markRead(authOf(res).user, param(req.params.id))))
      throw new DomainError('not_found');
    res.status(204).end();
  });
  return router;
}
