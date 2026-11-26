import { randomUUID } from 'node:crypto';

import { effectiveBard, type AiSettings } from '@vtt-chat-app/shared';

import type {
  GenerateText,
  Job,
  Segment,
  SummaryContext,
  SummaryKind,
  TranscribeWav,
  Utterance,
} from '../../types/index.js';
import type { LlmUsage } from '../../consts/claude.js';
import { describeJobModels, type LocalModelNames } from '../jobModels.js';
import { chatUtterances, mergeTimeline } from '../chat.js';
import { formatTranscript } from '../format.js';
import type { JobHandler } from '../jobs/worker.js';
import { mergeTranscripts } from '../merge.js';
import { buildWhisperPrompt, correctSegments } from '../vocabulary.js';
import {
  applyMemoryUpdate,
  buildMemoryPrompt,
  MEMORY_MAX_SHOWN_FOR_TALE,
  MEMORY_MAX_SHOWN_FOR_UPDATE,
  memoryLine,
  parseMemoryUpdate,
  relevantMemory,
} from '../memory.js';
import { buildJobProviders } from '../providers/fromSettings.js';
import { NOTES_MAX_WORDS } from '../notes.js';
import { CONDENSE_THRESHOLD } from '../../consts/index.js';
import { contextWindowTokens } from '../tokenBudget.js';
import { fitNotes, type FitResult } from '../fitNotes.js';
import { formatNotes, parseStoredNotes } from '../prompts.js';
import { stripThinking, takeNotes, writeFromNotes, type SummaryModels } from '../summarise.js';
import { planSummaries } from '../summaryPlan.js';
import { createDynamicPool } from './dynamicPool.js';
import type { RecordsStore } from './recordsStore.js';

export const PROCESS_RECORDING_JOB = 'process-recording';

// Found 2026-11-22: 10 chapters fired at once queued for 13 minutes with no progress output on a
// single-GPU remote Ollama. Pacing a few at a time keeps a GPU-bound backend busy without starving it.
const CHAPTER_CONCURRENCY = 2;

export interface ProcessRecordingDeps {
  records: RecordsStore;
  /** The always-configured local backends: the default, and the fallback for a remote one. */
  localTranscribe: (language: string, prompt?: string) => TranscribeWav;
  localGenerate: GenerateText;
  /** The local story-teller, when it is a different model from `localGenerate` (the scribe). */
  localStory?: GenerateText;
  /** Cuts a track file into speech windows and transcribes them (`transcribeTrackFile` in production). */
  transcribeAudioFile: (file: string, transcribeWav: TranscribeWav) => Promise<Segment[]>;
  env?: {
    WHISPER_API_KEY?: string | undefined;
    LLM_API_KEY?: string | undefined;
    ANTHROPIC_API_KEY?: string | undefined;
  };
  now?: () => number;
  log?: (line: string) => void;
  /** Asked before each Whisper window, model call, and (since Task 5) track dispatch
   *  (`createQuietGate`); absent means never wait. */
  gate?: () => Promise<void>;
  /** How many tracks may transcribe at once right now (the activity governor); absent means 1 (serial, today's behaviour). */
  trackConcurrency?: (tracksRemaining: number) => Promise<number>;
  /** The local models' names (the worker's `OLLAMA_MODEL` and `OLLAMA_STORY_MODEL`), so a job can say which it used. */
  localModelNames?: LocalModelNames;
  /** Overridable for tests that inject `fetch`. */
  buildProviders?: typeof buildJobProviders;
}

/**
 * The records job for one recording: transcribe every non-private track, merge by timestamp,
 * summarise. Safe to run again after any failure — each stage is skipped when its output already
 * exists, so a retry resumes (a track already transcribed is not transcribed twice, a summary
 * already written is not regenerated) instead of starting over.
 *
 * Privacy (CLAUDE.md §8.4): private tracks are skipped here *and* excluded by the store *and*
 * rejected by a database trigger; the DM-only summary is stored with visibility `dm`.
 */
export function createProcessRecordingHandler(deps: ProcessRecordingDeps): JobHandler {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const build = deps.buildProviders ?? buildJobProviders;

  const runJob = async (
    job: Job,
    seen: { settings?: AiSettings; fellBack: Set<'transcription' | 'llm'> },
    onUsage: (u: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    }) => void,
  ): Promise<void> => {
    if (!job.recordingId) throw new Error('process-recording job has no recording');
    const recording = await deps.records.getRecording(job.recordingId);
    if (!recording) throw new Error(`recording ${job.recordingId} does not exist`);
    await deps.records.setRecordingStatus(recording.id, 'processing');

    const settings: AiSettings = await deps.records.getAiSettings();
    seen.settings = settings;
    // The campaign's names (Stage 12): Whisper's starting prompt when the operator has it on, and the corrections
    // after. Gathered once per job; none of it for a recording whose campaign is gone.
    const mode = settings.transcription.glossary;
    const vocabulary =
      mode === 'off' ? [] : await deps.records.campaignVocabulary(recording.campaignId);
    const prompt =
      mode === 'prompt' || mode === 'both' ? buildWhisperPrompt(vocabulary) : undefined;
    // Alongside the cost tracking `onUsage` already does (outer closure, below): flag a call that ran
    // close to the configured context window, visible today via `docker compose logs worker` (a
    // `vtt-admin jobs list` column is a natural follow-up, not built here).
    const window = contextWindowTokens(settings.llm, settings.fallback.enabled);
    const checkedOnUsage: typeof onUsage = (u) => {
      if (u.inputTokens >= window * CONDENSE_THRESHOLD) {
        const pct = Math.round((u.inputTokens / window) * 100);
        log(`${recording.id}: a prompt used ${pct}% of the ${window}-token window`);
      }
      onUsage(u);
    };
    const providers = build(settings, {
      transcriptionPrompt: prompt,
      ...(deps.env ? { env: deps.env } : {}),
      localTranscribe: deps.localTranscribe,
      localGenerate: deps.localGenerate,
      ...(deps.localStory ? { localStory: deps.localStory } : {}),
      onUsage: checkedOnUsage,
      onFallback: (what, reason) => {
        seen.fellBack.add(what);
        log(`${recording.id}: ${what} fell back to local — ${reason}`);
      },
    });

    // Local AI waits here while a table is recording, when the operator has asked for that (quietGate.ts).
    const gate = deps.gate;
    const gated = <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
      gate
        ? async (...args: A): Promise<R> => {
            await gate();
            return call(...args);
          }
        : call;

    // 1. Transcribe every track that has not been done yet, several at once (bounded by the
    // activity governor), while Whisper itself still sees only one request in flight at a time.
    const tracks = await deps.records.listTracks(recording.id);
    for (const track of tracks) {
      if (track.private) log(`${recording.id}: skipping private track ${track.id}`);
    }
    const needsWork = tracks.filter((track) => !track.private && track.transcribedAt === null);
    const trackPool = createDynamicPool({
      currentLimit: async () => (await deps.trackConcurrency?.(needsWork.length)) ?? 1,
      ...(gate ? { gate } : {}),
    });
    // However many tracks run at once, Whisper itself only ever sees one request at a time.
    const whisperMutex = createDynamicPool({ currentLimit: async () => 1 });
    const mutexedTranscribeWav: TranscribeWav = (wav) =>
      whisperMutex.run(() => gated(providers.transcribe.call)(wav));

    const settled = await Promise.allSettled(
      needsWork.map((track) =>
        trackPool.run(async () => {
          log(`${recording.id}: transcribing ${track.speakerName}`);
          const heard = await deps.transcribeAudioFile(track.filePath, mutexedTranscribeWav);
          const segments =
            mode === 'corrections' || mode === 'both' ? correctSegments(heard, vocabulary) : heard;
          await deps.records.saveTrackTranscript(track.id, segments, now());
        }),
      ),
    );
    // One track's failure never costs the others their already-saved work: every track that
    // succeeded is saved above before this throws, so a retry only has to redo the one that failed.
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;

    // 2. Merge, 3. summarise.
    // Spoken lines, plus what people typed into the public chat during the recording (never whispers).
    const events = await deps.records.listRecordingEvents(recording.id);
    const utterances = mergeTimeline(
      mergeTranscripts(await deps.records.listTranscripts(recording.id)),
      chatUtterances(events, recording.startedAt),
    );
    const campaignName = await deps.records.campaignName(recording.campaignId);
    // Session and DM-only; a chapter per part when it was paused; one per player's character.
    const plan = planSummaries({
      utterances,
      events,
      startedAt: recording.startedAt,
      playerIds: new Set(await deps.records.playerIds(recording.campaignId)),
      ...(campaignName ? { campaignName } : {}),
    });

    // Who tells the tale and under what limits (Stage 12 G), and what the Game Master's own notes may reach: the
    // Chronicler (the Game Master's brief) and the Tipsy Minstrel only. The scribe and every other storyteller never
    // get them. The campaign's storyteller is read once, here, with the operator's switches applied.
    const storyteller = effectiveBard(
      await deps.records.campaignBard(recording.campaignId),
      settings.tale.storytellersOff,
    );
    let gmNotes: Promise<string> | undefined;
    // Campaign memory (Stage 12 F): what earlier sessions taught. Read before this session changes it, and only for
    // the tale and the brief; this session's own first-met entries (a reprocess) are left out, so it is not "met before".
    const memoryOn = settings.memory.enabled;
    const known = memoryOn ? await deps.records.listMemory(recording.campaignId) : [];
    const telling = async (
      kind: SummaryKind,
      notes: readonly string[],
    ): Promise<Partial<SummaryContext>> => {
      const remembered = relevantMemory(known, notes.join('\n'), MEMORY_MAX_SHOWN_FOR_TALE, {
        alwaysQuests: kind === 'dm-only',
        excludeFirstRecording: recording.id,
      }).map(memoryLine);
      const wantsNotes = kind === 'dm-only' || storyteller === 'drunken';
      gmNotes ??= wantsNotes ? deps.records.gmNotes(recording.campaignId) : undefined;
      const gm = wantsNotes ? await gmNotes : undefined;
      return {
        storyteller,
        taleLength: settings.tale.length,
        taleContent: settings.tale.content,
        ...(gm ? { gmNotes: gm } : {}),
        ...(remembered.length > 0 ? { memory: remembered } : {}),
      };
    };

    const learn = async (notes: readonly string[]): Promise<void> => {
      const shown = relevantMemory(known, notes.join('\n'), MEMORY_MAX_SHOWN_FOR_UPDATE, {
        alwaysQuests: true,
      });
      const prompt = buildMemoryPrompt(notes, shown, {
        campaignName: campaignName ?? undefined,
      });
      // An answer that is not entries or NONE is asked for once more; after that, this session teaches nothing.
      const updates =
        parseMemoryUpdate(stripThinking(await models.scribe(prompt))) ??
        parseMemoryUpdate(stripThinking(await models.scribe(prompt)));
      if (!updates) throw new Error('the model did not answer in the memory format');
      const changed = applyMemoryUpdate(known, updates, {
        recordingId: recording.id,
        now: now(),
        newId: randomUUID,
      });
      await deps.records.saveMemory(recording.campaignId, recording.id, changed, now());
      log(`${recording.id}: campaign memory: ${changed.length} entries new or changed`);
    };

    // The scribe's notes are taken once per stretch of recording and shared by every summary of it. With
    // chapters, each chapter is one stretch and the whole session is their notes in order; without, the
    // session is one stretch. Taken only when a summary still needs them, so a finished job re-run costs nothing.
    // The notes of the whole session are also stored, for the Game Master to read (below). A job that died
    // mid-way still takes them again: the stored copy is for reading, the transcripts (the slow part) are kept.
    const models: SummaryModels = {
      scribe: gated(providers.generate.call),
      bard: gated(providers.story.call),
    };
    // The notes cut down to fit the window are made once and shared by every summary of the recording (the tale, each
    // character's, the brief): the same notes, so the same shorter notes. The model calls go to the first summary.
    const fitted = new Map<string, Promise<FitResult>>();
    const credited = new Set<string>();
    const fit = async (notes: string[]): Promise<FitResult> => {
      const key = notes.join('\u0000');
      let result = fitted.get(key);
      if (!result) {
        result = fitNotes(async (prompt) => stripThinking(await models.scribe(prompt)), notes, {
          context: plan.find((p) => p.kind === 'session')?.context ?? {},
          window,
        });
        fitted.set(key, result);
      }
      const done = await result;
      if (credited.has(key)) return { notes: done.notes, modelCalls: 0 };
      credited.add(key);
      return done;
    };
    const chapters = plan.filter((p) => p.kind === 'chapter');
    const byChapter =
      chapters.length > 0 &&
      chapters.reduce((n, c) => n + c.utterances.length, 0) === utterances.length;
    let uncounted = 0; // note-taking calls not yet attributed to a stored summary
    const taken = new Map<string, Promise<string[]>>();
    const notesOf = (
      key: string,
      lines: Utterance[],
      context: SummaryContext,
      maxWords?: number,
    ): Promise<string[]> => {
      let notes = taken.get(key);
      if (!notes) {
        log(`${recording.id}: taking notes${key ? ` (part ${key})` : ''}`);
        notes = takeNotes(models.scribe, lines, { context, maxWords, llm: settings.llm }).then(
          (result) => {
            uncounted += result.modelCalls;
            return result.notes;
          },
        );
        taken.set(key, notes);
      }
      return notes;
    };
    // A retry after the notes were stored starts from them: taking them again is most of the hour (0.6.4 did, three times).
    if (byChapter) {
      const stored = await deps.records.getSummary(recording.id, 'notes', '');
      if (stored) {
        for (const [key, notes] of parseStoredNotes(stored.text)) {
          if (chapters.some((c) => c.subject === key)) taken.set(key, Promise.resolve(notes));
        }
      }
    }
    const sessionNotes = async (context: SummaryContext): Promise<string[]> => {
      if (!byChapter) return notesOf('', utterances, context);
      const parts: string[] = [];
      for (const c of chapters) parts.push(...(await notesOf(c.subject, c.utterances, c.context)));
      return parts;
    };

    // The scribe's notes, kept for the Game Master (decided 2026-11-17): players get the tale, the Game Master
    // also gets the plain record it was told from. Stored first, so the note-taking calls are counted here.
    const session = plan.find((p) => p.kind === 'session');
    if (
      session &&
      utterances.length > 0 &&
      !(await deps.records.getSummary(recording.id, 'notes', ''))
    ) {
      // Each chapter is its own stretch, capped on its own (`takeNotes`); concatenated, several chapters can
      // each reach that cap and together run well past it. Share the whole session's word budget across them
      // instead, so the stored notes stay near one cap rather than `chapters.length` of them.
      const chapterMaxWords =
        chapters.length > 0
          ? Math.max(300, Math.round(NOTES_MAX_WORDS / chapters.length))
          : undefined;
      const parts: { title?: string; notes: string[] }[] = [];
      if (byChapter) {
        for (let i = 0; i < chapters.length; i += CHAPTER_CONCURRENCY) {
          const batch = chapters.slice(i, i + CHAPTER_CONCURRENCY);
          const batchParts = await Promise.all(
            batch.map(async (c) => {
              const notes = await notesOf(c.subject, c.utterances, c.context, chapterMaxWords);
              log(`${recording.id}: chapter ${c.subject} notes ready`);
              return {
                title: `Part ${c.subject}${c.context.chapter?.title ? `: ${c.context.chapter.title}` : ''}`,
                notes,
              };
            }),
          );
          parts.push(...batchParts);
        }
      } else {
        parts.push({ notes: await sessionNotes(session.context) });
      }
      await deps.records.putSummary({
        recordingId: recording.id,
        kind: 'notes',
        subject: '',
        visibility: 'dm',
        text: formatNotes(parts),
        modelCalls: uncounted,
        createdAt: now(),
      });
      uncounted = 0;
    }

    for (const { kind, subject, visibility, utterances: covered, context } of plan) {
      if (await deps.records.getSummary(recording.id, kind, subject)) continue;
      if (covered.length === 0) {
        // A session with no speech is a result, not a failure; don't ask a model to invent one.
        await deps.records.putSummary({
          recordingId: recording.id,
          kind,
          subject,
          visibility,
          text: 'No speech or typed chat was detected in this recording.',
          modelCalls: 0,
          createdAt: now(),
        });
        continue;
      }
      log(`${recording.id}: writing ${kind}${subject ? ` (${subject})` : ''} summary`);
      const notes =
        kind === 'chapter'
          ? await notesOf(byChapter ? subject : `chapter ${subject}`, covered, context)
          : await sessionNotes(context);
      const result = await writeFromNotes(models, notes, {
        kind,
        context: { ...context, ...(await telling(kind, notes)) },
        llm: settings.llm,
        fallbackEnabled: settings.fallback.enabled,
        fit,
      });
      const modelCalls = result.modelCalls + uncounted;
      uncounted = 0;
      await deps.records.putSummary({
        recordingId: recording.id,
        kind,
        subject,
        visibility,
        text: result.text,
        modelCalls,
        createdAt: now(),
      });
    }

    // Last, and never a reason to fail a job whose tales are written: teach the memory from this session's notes.
    if (
      memoryOn &&
      session &&
      utterances.length > 0 &&
      !(await deps.records.memoryApplied(recording.id))
    ) {
      await learn(await sessionNotes(session.context)).catch((error: unknown) => {
        log(`${recording.id}: campaign memory not updated: ${String(error)}`);
      });
    }

    await deps.records.setRecordingStatus(recording.id, 'processed');
    // Tell the table. A failure here must not fail (and so re-run) a job that has just succeeded.
    await deps.records.notifySummaryReady(recording.id, now()).catch((error: unknown) => {
      log(`${recording.id}: could not store the "summary ready" notification: ${String(error)}`);
    });
    log(`${recording.id}: processed (${formatTranscript(utterances).length} transcript lines)`);
  };

  return {
    run: async (job: Job) => {
      // What Claude was asked, summed over the whole job (all calls), recorded even when the job fails: the tokens
      // were spent either way.
      let used: LlmUsage | undefined;
      const onUsage = (u: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        costUsd?: number;
      }): void => {
        used = {
          model: u.model,
          inputTokens: (used?.inputTokens ?? 0) + u.inputTokens,
          outputTokens: (used?.outputTokens ?? 0) + u.outputTokens,
          calls: (used?.calls ?? 0) + 1,
          ...(u.costUsd !== undefined || used?.costUsd !== undefined
            ? { costUsd: (used?.costUsd ?? 0) + (u.costUsd ?? 0) }
            : {}),
        };
      };
      // Which models did the work, recorded even when the job fails: the settings and any fallback are known by then.
      const seen: { settings?: AiSettings; fellBack: Set<'transcription' | 'llm'> } = {
        fellBack: new Set(),
      };
      try {
        await runJob(job, seen, onUsage);
      } finally {
        if (seen.settings) {
          await deps.records
            .setJobModels(
              job.id,
              describeJobModels(seen.settings, deps.localModelNames ?? { llm: 'the local model' }, [
                ...seen.fellBack,
              ]),
            )
            .catch((error: unknown) => {
              log(`${job.recordingId}: could not record which models were used: ${String(error)}`);
            });
        }
        if (used) {
          await deps.records.addJobUsage(job.id, used).catch((error: unknown) => {
            log(`${job.recordingId}: could not record Claude usage: ${String(error)}`);
          });
        }
      }
    },

    onGiveUp: async (job) => {
      if (job.recordingId) await deps.records.setRecordingStatus(job.recordingId, 'failed');
    },
  };
}
