import express, { Router } from 'express';
import { z } from 'zod';

import { MAX_HANDOUT_BYTES, MAX_HANDOUT_IMAGES } from '../../consts/index.js';
import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import type { Audience, HandoutService } from '../table/handoutService.js';
import type { Handout } from '../table/tableStore.js';
import { authOf, requireAuth } from './middleware.js';

export interface HandoutRouteDeps {
  accounts: AccountService;
  handouts: HandoutService;
  /** Tell live clients a handout was just shown to them. */
  onShown?: (campaignId: string, handout: Handout, audience: Audience) => void;
  /** Tell live clients a handout was hidden or deleted. */
  onRemoved?: (campaignId: string, handoutId: string) => void;
}

const textBody = z.object({ title: z.string().max(200), text: z.string().max(20_000) });
const editBody = z.object({
  title: z.string().max(200).optional(),
  text: z.string().max(20_000).optional(),
});
const imageQuery = z.object({ name: z.string().max(200).default('upload') });
const fileQuery = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(['image', 'map', 'pdf']),
  name: z.string().max(200).default('upload'),
});
const showBody = z.object({ to: z.union([z.literal('all'), z.array(z.string().max(64)).max(50)]) });

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

/** What a client may see of a handout. The file itself is fetched separately, with its own check. */
const view = (h: Handout) => ({
  id: h.id,
  title: h.title,
  kind: h.kind,
  body: h.body,
  hasFile: h.mediaIds.length > 0,
  fileCount: h.mediaIds.length,
  visibility: h.visibility,
  recipients: h.recipients,
  createdAt: h.createdAt,
});

/** Mounted at `/api/campaigns/:campaignId/handouts`. */
export function handoutRoutes(deps: HandoutRouteDeps): Router {
  const { handouts } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps.accounts));
  const campaign = (req: { params: object }): string =>
    param((req.params as { campaignId?: string }).campaignId);

  router.get('/', async (req, res) => {
    const list = await handouts.list(authOf(res).user, campaign(req));
    res.json({ handouts: list.map(view) });
  });

  router.post('/', async (req, res) => {
    const body = textBody.parse(req.body);
    const h = await handouts.createText(authOf(res).user, campaign(req), {
      title: body.title,
      body: body.text,
    });
    res.status(201).json({ handout: view(h) });
  });

  // A raw file body (not multipart): the type is decided from the bytes, never from this header.
  router.post(
    '/upload',
    express.raw({ type: () => true, limit: MAX_HANDOUT_BYTES + 1024 }),
    async (req, res) => {
      const query = fileQuery.safeParse(req.query);
      if (!query.success)
        throw new DomainError('invalid_input', 'title and kind (image, map or pdf) are required');
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const h = await handouts.createFile(authOf(res).user, campaign(req), {
        title: query.data.title,
        kind: query.data.kind,
        bytes,
        originalName: query.data.name,
      });
      res.status(201).json({ handout: view(h) });
    },
  );

  router.get('/:handoutId', async (req, res) => {
    res.json({
      handout: view(
        await handouts.get(authOf(res).user, campaign(req), param(req.params.handoutId)),
      ),
    });
  });

  const sendFile = async (
    res: express.Response,
    campaignId: string,
    handoutId: string,
    index: number,
  ) => {
    const { media, bytes } = await handouts.readFile(
      authOf(res).user,
      campaignId,
      handoutId,
      index,
    );
    res.setHeader('Content-Type', media.mime);
    res.setHeader('Content-Length', String(bytes.length));
    // Whatever the file is, a browser must treat it as inert data: no sniffing, no scripts, no framing.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(bytes);
  };

  router.get('/:handoutId/file', (req, res) =>
    sendFile(res, campaign(req), param(req.params.handoutId), 0),
  );

  router.get('/:handoutId/files/:index', (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_HANDOUT_IMAGES)
      throw new DomainError('not_found');
    return sendFile(res, campaign(req), param(req.params.handoutId), index);
  });

  router.delete('/:handoutId/files/:index', async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_HANDOUT_IMAGES)
      throw new DomainError('not_found');
    const h = await handouts.removeImage(
      authOf(res).user,
      campaign(req),
      param(req.params.handoutId),
      index,
    );
    res.json({ handout: view(h) });
  });

  router.put('/:handoutId/files', async (req, res) => {
    const body = z
      .object({ order: z.array(z.number().int()).max(MAX_HANDOUT_IMAGES) })
      .parse(req.body);
    const h = await handouts.reorderImages(
      authOf(res).user,
      campaign(req),
      param(req.params.handoutId),
      body.order,
    );
    res.json({ handout: view(h) });
  });

  // Another picture for a picture handout: a raw body like the first upload.
  router.post(
    '/:handoutId/images',
    express.raw({ type: () => true, limit: MAX_HANDOUT_BYTES + 1024 }),
    async (req, res) => {
      const query = imageQuery.safeParse(req.query);
      if (!query.success) throw new DomainError('invalid_input', 'the picture needs a name');
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const h = await handouts.addImage(
        authOf(res).user,
        campaign(req),
        param(req.params.handoutId),
        { bytes, originalName: query.data.name },
      );
      res.json({ handout: view(h) });
    },
  );

  router.patch('/:handoutId', async (req, res) => {
    const body = editBody.parse(req.body);
    const handout = await handouts.update(
      authOf(res).user,
      campaign(req),
      param(req.params.handoutId),
      body,
    );
    res.json({ handout: view(handout) });
  });

  router.post('/:handoutId/show', async (req, res) => {
    const body = showBody.parse(req.body);
    const { handout, audience } = await handouts.show(
      authOf(res).user,
      campaign(req),
      param(req.params.handoutId),
      body.to,
    );
    deps.onShown?.(handout.campaignId, handout, audience);
    res.json({ handout: view(handout) });
  });

  router.post('/:handoutId/hide', async (req, res) => {
    const handout = await handouts.hide(
      authOf(res).user,
      campaign(req),
      param(req.params.handoutId),
    );
    deps.onRemoved?.(handout.campaignId, handout.id);
    res.json({ handout: view(handout) });
  });

  router.delete('/:handoutId', async (req, res) => {
    const id = param(req.params.handoutId);
    const campaignId = campaign(req);
    await handouts.delete(authOf(res).user, campaignId, id);
    deps.onRemoved?.(campaignId, id);
    res.status(204).end();
  });

  return router;
}
