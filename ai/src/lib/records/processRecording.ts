import type { AiSettings } from '@vtt-chat-app/shared';

import type { GenerateText, Job, Segment, SummaryKind, TranscribeWav } from '../../types/index.js';
import { formatTranscript } from '../format.js';
import type { JobHandler } from '../jobs/worker.js';
import { mergeTranscripts } from '../merge.js';
import { buildJobProviders } from '../providers/fromSettings.js';
import { summarise } from '../summarise.js';
import type { RecordsStore } from './recordsStore.js';

export const PROCESS_RECORDING_JOB = 'process-recording';

export interface ProcessRecordingDeps {
  records: RecordsStore;
  /** The always-configured local backends: the default, and the fallback for a remote one. */
  localTranscribe: (language: string) => TranscribeWav;
  localGenerate: GenerateText;
  /** Cuts a track file into speech windows and transcribes them (`transcribeTrackFile` in production). */
  transcribeAudioFile: (file: string, transcribeWav: TranscribeWav) => Promise<Segment[]>;
  env?: { WHISPER_API_KEY?: string | undefined; LLM_API_KEY?: string | undefined };
  now?: () => number;
  log?: (line: string) => void;
  /** Overridable for tests that inject `fetch`. */
  buildProviders?: typeof buildJobProviders;
}

/** Which summaries a processed recording gets, and who may read each. */
const SUMMARIES: { kind: SummaryKind; visibility: 'members' | 'dm' }[] = [
  { kind: 'session', visibility: 'members' },
  { kind: 'dm-only', visibility: 'dm' },
];

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

  return {
    run: async (job: Job) => {
      if (!job.recordingId) throw new Error('process-recording job has no recording');
      const recording = await deps.records.getRecording(job.recordingId);
      if (!recording) throw new Error(`recording ${job.recordingId} does not exist`);
      await deps.records.setRecordingStatus(recording.id, 'processing');

      const settings: AiSettings = await deps.records.getAiSettings();
      const providers = build(settings, {
        ...(deps.env ? { env: deps.env } : {}),
        localTranscribe: deps.localTranscribe,
        localGenerate: deps.localGenerate,
        onFallback: (what, reason) =>
          log(`${recording.id}: ${what} fell back to local — ${reason}`),
      });

      // 1. Transcribe each track that has not been done yet.
      for (const track of await deps.records.listTracks(recording.id)) {
        if (track.private) {
          log(`${recording.id}: skipping private track ${track.id}`);
          continue;
        }
        if (track.transcribedAt !== null) continue;
        log(`${recording.id}: transcribing ${track.speakerName}`);
        const segments = await deps.transcribeAudioFile(track.filePath, providers.transcribe.call);
        await deps.records.saveTrackTranscript(track.id, segments, now());
      }

      // 2. Merge, 3. summarise.
      const utterances = mergeTranscripts(await deps.records.listTranscripts(recording.id));
      const campaignName = await deps.records.campaignName(recording.campaignId);
      for (const { kind, visibility } of SUMMARIES) {
        if (await deps.records.getSummary(recording.id, kind, '')) continue;
        if (utterances.length === 0) {
          // A session with no speech is a result, not a failure; don't ask a model to invent one.
          await deps.records.putSummary({
            recordingId: recording.id,
            kind,
            subject: '',
            visibility,
            text: 'No speech was detected in this recording.',
            modelCalls: 0,
            createdAt: now(),
          });
          continue;
        }
        log(`${recording.id}: writing ${kind} summary`);
        const result = await summarise(providers.generate.call, utterances, {
          kind,
          context: campaignName ? { campaignName } : {},
        });
        await deps.records.putSummary({
          recordingId: recording.id,
          kind,
          subject: '',
          visibility,
          text: result.text,
          modelCalls: result.modelCalls,
          createdAt: now(),
        });
      }

      await deps.records.setRecordingStatus(recording.id, 'processed');
      log(`${recording.id}: processed (${formatTranscript(utterances).length} transcript lines)`);
    },

    onGiveUp: async (job) => {
      if (job.recordingId) await deps.records.setRecordingStatus(job.recordingId, 'failed');
    },
  };
}
