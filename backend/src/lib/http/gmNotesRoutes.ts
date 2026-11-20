import { GM_NOTES_BODY_MAX } from '@vtt-chat-app/shared';
import express, { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import type { GmNotesService } from '../table/gmNotesService.js';
import type { GlossaryTerm } from '../table/tableStore.js';
import { authOf, requireAuth } from './middleware.js';

export interface GmNotesRouteDeps {
  accounts: AccountService;
  gm: GmNotesService;
  /** The largest attachment, so the raw-body reader refuses more before it is buffered. */
  maxFileBytes: number;
}

/** The notes' own JSON ceiling: a page of GM_NOTES_BODY_MAX characters at four bytes each, plus the envelope. */
export const GM_NOTES_JSON_LIMIT = GM_NOTES_BODY_MAX * 4 + 1024;

const notesBody = z.object({ body: z.string() });
const fileQuery = z.object({ name: z.string().max(200).default('attachment') });
const termBody = z.object({
  term: z.string().max(1000),
  kind: z.string().max(40).optional(),
  aliases: z.array(z.string().max(1000)).max(100).optional(),
});
const termPatch = termBody.partial();

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

const termView = (t: GlossaryTerm) => ({
  id: t.id,
  term: t.term,
  kind: t.kind,
  aliases: t.aliases,
  status: t.status,
});

/**
 * The Game Master's notes and glossary, mounted at `/api/campaigns/:campaignId/gm`. **Everything here is the Game
 * Master's alone**; the service refuses a player, and a campaign's file is indistinguishable from a missing one
 * when asked for through another campaign.
 */
export function gmNotesRoutes(deps: GmNotesRouteDeps): Router {
  const { gm } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps.accounts));
  const campaign = (req: { params: object }): string =>
    param((req.params as { campaignId?: string }).campaignId);

  router.get('/notes', async (req, res) => {
    res.json(await gm.get(authOf(res).user, campaign(req)));
  });

  router.put('/notes', express.json({ limit: GM_NOTES_JSON_LIMIT }), async (req, res) => {
    const body = notesBody.safeParse(req.body);
    if (!body.success) throw new DomainError('invalid_input', 'the notes must be text');
    res.json(await gm.save(authOf(res).user, campaign(req), body.data.body));
  });

  // A raw file body (not multipart): the type is decided from the bytes, never from the header.
  router.post(
    '/notes/files',
    express.raw({ type: () => true, limit: deps.maxFileBytes + 1024 }),
    async (req, res) => {
      const query = fileQuery.safeParse(req.query);
      if (!query.success) throw new DomainError('invalid_input', 'bad file name');
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const file = await gm.addFile(authOf(res).user, campaign(req), {
        bytes,
        name: query.data.name,
      });
      res.status(201).json({ file });
    },
  );

  router.get('/notes/files/:fileId', async (req, res) => {
    const { media, bytes } = await gm.readFile(
      authOf(res).user,
      campaign(req),
      param(req.params.fileId),
    );
    res.setHeader('Content-Type', media.mime);
    res.setHeader('Content-Length', String(bytes.length));
    // Inert data, whatever it is: no sniffing, no scripts, no framing.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(bytes);
  });

  router.delete('/notes/files/:fileId', async (req, res) => {
    await gm.removeFile(authOf(res).user, campaign(req), param(req.params.fileId));
    res.status(204).end();
  });

  router.get('/glossary', async (req, res) => {
    const terms = await gm.listGlossary(authOf(res).user, campaign(req));
    res.json({ terms: terms.map(termView) });
  });

  router.post('/glossary', async (req, res) => {
    const body = termBody.safeParse(req.body);
    if (!body.success) throw new DomainError('invalid_input', 'a term needs its text');
    const term = await gm.addTerm(authOf(res).user, campaign(req), body.data);
    res.status(201).json({ term: termView(term) });
  });

  router.patch('/glossary/:termId', async (req, res) => {
    const body = termPatch.safeParse(req.body);
    if (!body.success) throw new DomainError('invalid_input', 'bad term');
    const term = await gm.updateTerm(authOf(res).user, campaign(req), param(req.params.termId), {
      ...(body.data.term === undefined ? {} : { term: body.data.term }),
      ...(body.data.kind === undefined ? {} : { kind: body.data.kind }),
      ...(body.data.aliases === undefined ? {} : { aliases: body.data.aliases }),
    });
    res.json({ term: termView(term) });
  });

  router.post('/glossary/:termId/approve', async (req, res) => {
    const term = await gm.approveTerm(authOf(res).user, campaign(req), param(req.params.termId));
    res.json({ term: termView(term) });
  });

  router.delete('/glossary/:termId', async (req, res) => {
    await gm.removeTerm(authOf(res).user, campaign(req), param(req.params.termId));
    res.status(204).end();
  });

  return router;
}
