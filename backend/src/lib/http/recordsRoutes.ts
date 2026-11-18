import {
  AUDIO_NOTICE_DAYS,
  chatUtterances,
  DELETE_RECORDING_JOB,
  mergeTimeline,
  mergeTranscripts,
  planChapters,
  type JobQueue,
  type RecordsStore,
  type StoredSummary,
} from '@vtt-chat-app/ai';
import { DM_DELETE_MAX_MINUTES } from '@vtt-chat-app/shared';
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
  /** Where the worker's jobs are queued (deleting a short session removes its audio files, which only the worker can see). */
  jobs?: JobQueue;
  /** Told when the DM's app reports a character voice, for the recording's timeline. */
  onVoiceEffect?: (campaignId: string, accountId: string, voice: string) => void;
  /** Server dev mode (`DEV_MODE=1`): a DM may delete a session of any length. Off: only short test sessions. */
  devMode?: boolean;
}

const voiceBody = z.object({
  voice: z
    .string()
    .trim()
    .regex(/^[a-z][a-z-]{1,23}$/),
});

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
 * - **DM-only summaries are returned to the DM alone** — in lists, detail and search alike. The scribe's
 *   notes are one of them;
 * - **the transcript is the DM's alone** (decided 2026-11-17): players get the tale, not the raw record, and
 *   their search covers the summaries only. The apps show the transcript only to a DM who turned on dev
 *   builds; that part is a display choice, the DM rule here is the access rule;
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

  // The session's tale leads (it is what most people open the history for), then its parts and each hero's
  // tale; the Game Master's working material (brief, scribe's notes) comes after them.
  const ORDER: readonly string[] = ['session', 'chapter', 'character', 'dm-only', 'notes'];
  const rank = (s: StoredSummary) => ORDER.indexOf(s.kind);
  const visible = (summaries: StoredSummary[], isDm: boolean) =>
    summaries
      .filter((s) => s.visibility === 'members' || isDm)
      .map((s, i) => ({ s, i }))
      .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
      .map(({ s }) => s);

  router.get('/', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    const list = await records.listRecordingsForCampaign(campaignId);
    const items = [];
    for (const r of list) {
      // The list names what there is to read; the scribe's notes are folded away in the detail, so not here.
      const summaries = visible(await records.listSummaries(r.id), isDm).filter(
        (s) => s.kind !== 'notes',
      );
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

  // The DM's app reports a character-voice change (the voice runs in Rust and the server never sees it
  // otherwise), so a recording's timeline can say who spoke in which voice. Metadata only; DM only.
  router.post('/voice-effect', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    if (!isDm) throw new DomainError('forbidden', 'only the DM has character voices');
    const parsed = voiceBody.safeParse(req.body);
    if (!parsed.success)
      throw new DomainError('invalid_input', 'voice must be a short lowercase name');
    deps.onVoiceEffect?.(campaignId, authOf(res).user.id, parsed.data.voice);
    res.status(204).end();
  });

  // Declared before '/:recordingId' so "search" is not taken for an id.
  router.get('/search', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) throw new DomainError('invalid_input', 'q must be 2–200 characters');
    const hits = await records.search(campaignId, parsed.data.q, {
      includeDmOnly: isDm,
      includeTranscript: isDm,
      limit: parsed.data.limit,
    });
    res.json({ hits });
  });

  router.get('/:recordingId', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    const recording = await ownRecording(campaignId, param(req.params.recordingId));
    const [events, summaries, transcripts] = await Promise.all([
      records.listRecordingEvents(recording.id),
      records.listSummaries(recording.id),
      records.listTranscripts(recording.id),
    ]);
    // The chapters as the worker cut them (a pause or a scene change starts one), so a chapter summary can be
    // shown under its scene's name. The same function the worker used: numbers and titles agree.
    const chapters = planChapters({
      events,
      startedAt: recording.startedAt,
      utterances: mergeTimeline(
        mergeTranscripts(transcripts),
        chatUtterances(events, recording.startedAt),
      ),
    });
    const title = new Map(chapters.map((c) => [String(c.number), c.title]));
    res.json({
      recording: {
        id: recording.id,
        startedAt: recording.startedAt,
        stoppedAt: recording.stoppedAt,
        status: recording.status,
      },
      events: events.map((e) => ({ at: e.at, event: e.event })),
      ...(chapters.length > 1
        ? {
            chapters: chapters.map((c) => ({
              number: c.number,
              startMs: c.startMs,
              ...(c.title ? { title: c.title } : {}),
            })),
          }
        : {}),
      summaries: visible(summaries, isDm).map((s) => {
        const t = s.kind === 'chapter' ? title.get(s.subject) : undefined;
        return { ...summaryView(s), ...(t ? { title: t } : {}) };
      }),
    });
  });

  router.get('/:recordingId/transcript', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    if (!isDm) throw new DomainError('forbidden', 'only the DM can read the transcript');
    const recording = await ownRecording(campaignId, param(req.params.recordingId));
    // What was said and what was typed into the public chat, on one timeline: the same lines the
    // summaries were written from. Typed lines are marked; whispers and out-of-character lines never
    // reach the recording's timeline, and chatUtterances refuses them again.
    const events = await records.listRecordingEvents(recording.id);
    const utterances = mergeTimeline(
      mergeTranscripts(await records.listTranscripts(recording.id)),
      chatUtterances(events, recording.startedAt),
    );
    // Scene changes ride alongside as markers (a "Scene: <name>" divider between the lines). Names only:
    // the scene was announced to the whole table when it started.
    const markers = events.flatMap((e) =>
      e.event === 'scene' && e.detail?.action === 'start' && typeof e.detail.name === 'string'
        ? [
            {
              atMs: Math.max(0, e.at - recording.startedAt),
              kind: 'scene' as const,
              text: e.detail.name,
            },
          ]
        : [],
    );
    res.json({
      utterances: utterances.map((u) => ({
        speaker: u.speaker,
        startMs: u.startMs,
        endMs: u.endMs,
        text: u.text,
        ...(u.typed ? { typed: true } : {}),
      })),
      ...(markers.length > 0 ? { markers } : {}),
    });
  });

  // The raw audio is the operator's to remove (retention settings, `vtt-admin recording purge`), never the Game
  // Master's (Andy, 2026-11-18). Older apps still show the button; they get a clear answer, not a missing route.
  router.post('/:recordingId/audio/delete', async (req, res) => {
    await membership(req, authOf(res).user.id);
    throw new DomainError(
      'forbidden',
      'the audio is cleaned up by the server’s operator, not from the app',
    );
  });

  // Any DM can delete a short test session and everything under it, audio included. A longer one needs the server
  // in dev mode (`DEV_MODE=1`) AND the DM's app with dev builds on (the app only shows the button then): the
  // operator has the final say, so a server not in dev mode refuses however the app is set (Andy, 2026-11-18).
  router.delete('/:recordingId', async (req, res) => {
    const { campaignId, isDm } = await membership(req, authOf(res).user.id);
    if (!isDm) throw new DomainError('forbidden', 'only the DM can delete recordings');
    const recording = await ownRecording(campaignId, param(req.params.recordingId));
    if (recording.status === 'recording' || recording.status === 'processing') {
      throw new DomainError('conflict', 'that recording is still in progress or being processed');
    }
    const minutes = ((recording.stoppedAt ?? recording.startedAt) - recording.startedAt) / 60_000;
    if (minutes >= DM_DELETE_MAX_MINUTES && !deps.devMode) {
      throw new DomainError(
        'conflict',
        `only a session shorter than ${DM_DELETE_MAX_MINUTES} minutes can be deleted from the app unless the server is in dev mode; ask the server’s operator`,
      );
    }
    // The worker deletes the audio files, then the recording; with no queue (tests) there are no files to find.
    if (deps.jobs) {
      await deps.jobs.enqueue(
        { kind: DELETE_RECORDING_JOB, recordingId: recording.id },
        Date.now(),
      );
      res.status(202).json({ deleting: true });
      return;
    }
    await records.deleteRecording(recording.id);
    res.status(204).end();
  });

  return router;
}
