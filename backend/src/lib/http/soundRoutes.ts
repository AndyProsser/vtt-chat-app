import express, { Router } from 'express';
import { z } from 'zod';

import { MAX_SOUND_BYTES } from '../../consts/index.js';
import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import type { SoundLibraryService } from '../soundboard/soundLibraryService.js';
import { authOf, requireAuth } from './middleware.js';

export interface SoundRouteDeps {
  accounts: AccountService;
  library: SoundLibraryService;
}

const category = z.enum(['effect', 'ambience', 'music']);
const uploadQuery = z.object({
  name: z.string().min(1).max(120),
  category,
  tags: z.string().max(800).optional(),
  filename: z.string().max(200).default('upload'),
});
const takeQuery = z.object({
  level: z.coerce.number().min(0).max(1).optional(),
  filename: z.string().max(200).default('upload'),
});
const patchBody = z.object({
  name: z.string().max(120).optional(),
  category: category.optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  levels: z.record(z.string(), z.number().min(0).max(1)).optional(),
});
const boardBody = z.object({
  name: z.string().max(120),
  buttons: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        label: z.string().max(120),
        soundId: z.string().max(64),
        mode: z.enum(['oneshot', 'loop']).optional(),
        volume: z.number().min(0).max(1).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .max(60),
});
const sceneBody = z.object({
  name: z.string().max(120),
  layers: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        soundId: z.string().max(64),
        mode: z.enum(['loop', 'random']).optional(),
        volume: z.number().min(0).max(1).optional(),
        minIntervalSec: z.number().min(1).max(3600).nullable().optional(),
        maxIntervalSec: z.number().min(1).max(3600).nullable().optional(),
      }),
    )
    .max(12),
});

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

const rawAudio = express.raw({ type: () => true, limit: MAX_SOUND_BYTES + 1024 });
const bytesOf = (body: unknown): Buffer => (Buffer.isBuffer(body) ? body : Buffer.alloc(0));

/** The DM's library at `/api/soundboard`. Everything is the signed-in account's own. */
export function soundLibraryRoutes(deps: SoundRouteDeps): Router {
  const { library } = deps;
  const router = Router();
  router.use(requireAuth(deps.accounts));

  router.get('/library', async (_req, res) => {
    res.json(await library.library(authOf(res).user));
  });

  router.post('/sounds/upload', rawAudio, async (req, res) => {
    const q = uploadQuery.safeParse(req.query);
    if (!q.success)
      throw new DomainError(
        'invalid_input',
        'name and category (effect, ambience or music) are required',
      );
    const sound = await library.addSound(authOf(res).user, {
      name: q.data.name,
      category: q.data.category,
      tags: q.data.tags ? q.data.tags.split(',') : [],
      bytes: bytesOf(req.body),
      originalName: q.data.filename,
    });
    res.status(201).json({ sound });
  });

  router.post('/sounds/:id/takes', rawAudio, async (req, res) => {
    const q = takeQuery.parse(req.query);
    const sound = await library.addTake(authOf(res).user, param(req.params.id), {
      bytes: bytesOf(req.body),
      originalName: q.filename,
      ...(q.level !== undefined ? { level: q.level } : {}),
    });
    res.status(201).json({ sound });
  });

  router.patch('/sounds/:id', async (req, res) => {
    const body = patchBody.parse(req.body);
    const patch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.levels !== undefined ? { levels: body.levels } : {}),
    };
    res.json({ sound: await library.updateSound(authOf(res).user, param(req.params.id), patch) });
  });

  router.delete('/sounds/:id/takes/:takeId', async (req, res) => {
    res.json({
      sound: await library.removeTake(
        authOf(res).user,
        param(req.params.id),
        param(req.params.takeId),
      ),
    });
  });

  router.delete('/sounds/:id', async (req, res) => {
    await library.deleteSound(authOf(res).user, param(req.params.id));
    res.status(204).end();
  });

  router.post('/boards', async (req, res) => {
    res.status(201).json({
      board: await library.saveBoard(authOf(res).user, undefined, boardBody.parse(req.body)),
    });
  });
  router.put('/boards/:id', async (req, res) => {
    res.json({
      board: await library.saveBoard(
        authOf(res).user,
        param(req.params.id),
        boardBody.parse(req.body),
      ),
    });
  });
  router.delete('/boards/:id', async (req, res) => {
    await library.deleteBoard(authOf(res).user, param(req.params.id));
    res.status(204).end();
  });

  router.post('/scenes', async (req, res) => {
    res.status(201).json({
      scene: await library.saveScene(authOf(res).user, undefined, sceneBody.parse(req.body)),
    });
  });
  router.put('/scenes/:id', async (req, res) => {
    res.json({
      scene: await library.saveScene(
        authOf(res).user,
        param(req.params.id),
        sceneBody.parse(req.body),
      ),
    });
  });
  router.delete('/scenes/:id', async (req, res) => {
    await library.deleteScene(authOf(res).user, param(req.params.id));
    res.status(204).end();
  });

  return router;
}

/** Clip downloads for a campaign's players, at `/api/campaigns/:campaignId/sounds`. */
export function soundPlaybackRoutes(deps: SoundRouteDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps.accounts));
  router.get('/takes/:takeId/file', async (req, res) => {
    const campaignId = param((req.params as { campaignId?: string }).campaignId);
    const { media, bytes } = await deps.library.readTake(
      authOf(res).user,
      campaignId,
      param(req.params.takeId),
    );
    res.setHeader('Content-Type', media.mime);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.end(bytes);
  });
  return router;
}
