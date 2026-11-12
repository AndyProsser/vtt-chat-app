import {
  AUDIO_NOTICE_DAYS,
  chatUtterances,
  mergeTimeline,
  mergeTranscripts,
  PURGE_RECORDING_JOB,
  type JobQueue,
  type RecordsStore,
  type StoredSummary,
} from '@vtt-chat-app/ai';
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
  /** Where the worker's jobs are queued. Without it, deleting audio from the app is unavailable. */
  jobs?: JobQueue;
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

  /** Whether a recording's raw audio is still on the server: all of it, none of it, or some. */
  const audioState = async (
    recordingId: string,
  ): Promise<'kept' | 'purged' | 'partly' | 'none'> => {
    const tracks = await records.listTracks(recordingId);
    if (tracks.length === 0) return 'none';
    const purged = tracks.filter((t) => (t.purgedAt ?? null) !== null).length;
    return purged === 0 ? 'kept' : purged === tracks.length ? 'purged' : 'partly';
  };

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
        // Retention is the operator's and the DM's business: players are not told.
        ...(isDm ? { audio: await audioState(r.id) } : {}),
        // When the audio will be deleted anyway to free disk space, so the DM can decide first.
        ...(isDm && r.audioNoticeAt != null
          ? { audioDeletedOn: r.audioNoticeAt + AUDIO_NOTICE_DAYS * 86_400_000 }
          : {}),
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
    // What was said and what was typed into the public chat, on one timeline: the same lines the
    // summaries were written from. Typed lines are marked; whispers and out-of-character lines never
    // reach the recording's timeline, and chatUtterances refuses them again.
    const utterances = mergeTimeline(
      mergeTranscripts(await records.listTranscripts(recording.id)),
      chatUtterances(await records.listRecordingEvents(recording.id), recording.startedAt),
    );
    res.json({
      utterances: utterances.map((u) => ({
        speaker: u.speaker,
        startMs: u.startMs,
        endMs: u.endMs,
        text: u.text,
        ...(u.typed ? { typed: true } : {}),
      })),
    });
  });

  // The DM says the summary is good and the raw audio can go. The worker, which can see the files, does the
  // deleting; the transcript and the summaries stay. Only a processed recording: until then its audio is the
  // input to the transcript.
  router.post('/:recordingId/audio/delete', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    if (!isDm) throw new DomainError('forbidden', 'only the DM can delete a recording’s audio');
    const recording = await ownRecording(campaignId, param(req.params.recordingId));
    if (recording.status !== 'processed') {
      throw new DomainError(
        'conflict',
        'the recording is not processed yet, so its audio is still needed',
      );
    }
    const state = await audioState(recording.id);
    if (state === 'purged' || state === 'none') {
      throw new DomainError('conflict', 'there is no audio left to delete');
    }
    if (!deps.jobs)
      throw new DomainError('conflict', 'deleting audio is not available on this server');
    await deps.jobs.enqueue({ kind: PURGE_RECORDING_JOB, recordingId: recording.id }, Date.now());
    res.status(202).json({ audio: 'deleting' });
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
