import { randomUUID } from 'node:crypto';

import express, { Router } from 'express';

import { MAX_AVATAR_BYTES } from '../../consts/index.js';
import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import { detectMedia, type MediaStorage } from '../media/mediaStorage.js';
import type { Store } from '../store/store.js';
import { authOf, requireAuth } from './middleware.js';

export interface AvatarRouteDeps {
  accounts: AccountService;
  media: MediaStorage;
  store: Store;
  now?: () => number;
}

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Mounted at `/api/avatars`. Portraits are small pictures (the app shrinks them before sending) kept by
 * an unguessable id and readable by anyone signed in, so a character's portrait shows to the table. They
 * are not tied to a campaign, which keeps this to two routes; an unused picture is just a few kilobytes.
 */
export function avatarRoutes({ accounts, media, store, now = Date.now }: AvatarRouteDeps): Router {
  const router = Router();
  router.use(requireAuth(accounts));

  // A raw body, not multipart: the type is decided from the bytes, never from a header.
  router.post(
    '/upload',
    express.raw({ type: () => true, limit: MAX_AVATAR_BYTES + 1024 }),
    async (req, res) => {
      const { user } = authOf(res);
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) throw new DomainError('invalid_input', 'the picture is empty');
      if (bytes.length > MAX_AVATAR_BYTES)
        throw new DomainError('too_large', 'that picture is too large');
      if (detectMedia(bytes)?.kind !== 'image')
        throw new DomainError('unsupported_media', 'that is not a PNG, JPEG, GIF or WebP picture');
      const id = randomUUID();
      await media.put(id, bytes);
      await store.recordAvatarFile(id, user.id, now());
      res.status(201).json({ id });
    },
  );

  router.get('/:id', async (req, res) => {
    const id = req.params.id;
    const bytes = SAFE_ID.test(id) ? await media.get(id) : undefined;
    const detected = bytes ? detectMedia(bytes) : undefined;
    if (!bytes || detected?.kind !== 'image') throw new DomainError('not_found', 'no such picture');
    res.setHeader('Content-Type', detected.mime);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(bytes);
  });

  return router;
}
