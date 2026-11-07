import { mergeTranscripts, type RecordsStore, type StoredSummary } from '@vtt-chat-app/ai';
import { Router } from 'express';
import { z } from 'zod';

import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import { authOf, requireAuth } from './middleware.js';

export interface RecordsRouteDeps {
  accounts: AccountService;
  store: Store;
  records: RecordsStore;
}

const searchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

function param(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || value.length === 0) throw new DomainError('invalid_input');
  return value;
}

/** The public shape of a summary. Never includes anything about how it was produced beyond the count. */
const summaryView = (s: StoredSummary) => ({
  kind: s.kind,
  subject: s.subject,
  visibility: s.visibility,
  text: s.text,
  createdAt: s.createdAt,
});

/**
 * A campaign's history: its recordings, transcripts, summaries and search. Mounted at
 * `/api/campaigns/:campaignId/recordings`.
 *
 * Access rules (CLAUDE.md §8.4), enforced here at the API and not by hiding things in a UI:
 * - only members of the campaign can read anything; everyone else gets `forbidden`;
 * - **DM-only summaries are returned to the DM alone** — in lists, detail and search alike;
 * - a recording is only reachable through its own campaign, so knowing a recording id from
 *   another campaign reveals nothing (`not_found`, indistinguishable from a missing one);
 * - private tracks never appear: the store does not return them.
 */
export function recordsRoutes(deps: RecordsRouteDeps): Router {
  const { store, records } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps.accounts));

  async function membership(req: { params: object }, userId: string) {
    const campaignId = param((req.params as { campaignId?: string | string[] }).campaignId);
    const m = await store.getMembership(campaignId, userId);
    if (!m) throw new DomainError('forbidden', 'not a member of this campaign');
    return { campaignId, isDm: m.role === 'dm' };
  }

  async function ownRecording(campaignId: string, recordingId: string) {
    const recording = await records.getRecording(recordingId);
    if (!recording || recording.campaignId !== campaignId) throw new DomainError('not_found');
    return recording;
  }

  const visible = (summaries: StoredSummary[], isDm: boolean) =>
    summaries.filter((s) => s.visibility === 'members' || isDm);

  router.get('/', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    const list = await records.listRecordingsForCampaign(campaignId);
    const items = [];
    for (const r of list) {
      const summaries = visible(await records.listSummaries(r.id), isDm);
      items.push({
        id: r.id,
        startedAt: r.startedAt,
        stoppedAt: r.stoppedAt,
        status: r.status,
        summaries: summaries.map((s) => s.kind),
      });
    }
    res.json({ recordings: items });
  });

  // Declared before '/:recordingId' so "search" is not taken for an id.
  router.get('/search', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) throw new DomainError('invalid_input', 'q must be 2–200 characters');
    const hits = await records.search(campaignId, parsed.data.q, {
      includeDmOnly: isDm,
      limit: parsed.data.limit,
    });
    res.json({ hits });
  });

  router.get('/:recordingId', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    const recording = await ownRecording(campaignId, param(req.params.recordingId));
    const [events, summaries] = await Promise.all([
      records.listRecordingEvents(recording.id),
      records.listSummaries(recording.id),
    ]);
    res.json({
      recording: {
        id: recording.id,
        startedAt: recording.startedAt,
        stoppedAt: recording.stoppedAt,
        status: recording.status,
      },
      events: events.map((e) => ({ at: e.at, event: e.event })),
      summaries: visible(summaries, isDm).map(summaryView),
    });
  });

  router.get('/:recordingId/transcript', async (req, res) => {
    const { campaignId } = await membership(req, authOf(res).user.id);
    const recording = await ownRecording(campaignId, param(req.params.recordingId));
    const utterances = mergeTranscripts(await records.listTranscripts(recording.id));
    res.json({
      utterances: utterances.map((u) => ({
        speaker: u.speaker,
        startMs: u.startMs,
        endMs: u.endMs,
        text: u.text,
      })),
    });
  });

  // The DM can delete a campaign's records (RECORDING-AND-SUMMARIES.md, Access & retention).
  router.delete('/:recordingId', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    if (!isDm) throw new DomainError('forbidden', 'only the DM can delete recordings');
    const recording = await ownRecording(campaignId, param(req.params.recordingId));
    if (recording.status === 'recording' || recording.status === 'processing') {
      throw new DomainError('conflict', 'that recording is still in progress or being processed');
    }
    await records.deleteRecording(recording.id);
    res.status(204).end();
  });

  return router;
}
