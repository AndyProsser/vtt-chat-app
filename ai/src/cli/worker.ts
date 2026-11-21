#!/usr/bin/env node
/**
 * The records worker: claims `process-recording` jobs from Postgres and runs them (transcribe →
 * merge → summarise). Configuration is the environment; *where* Whisper and the LLM run (local or a
 * remote OpenAI-compatible server) is the operator's AI setting, read per job from the database.
 *
 *   DATABASE_URL        Postgres (required)
 *   WHISPER_LOCAL_URL   the local Whisper as an OpenAI-compatible server (the Compose bundle's `whisper`), OR
 *   WHISPER_MODEL_FILE        the ggml file the local whisper-server runs (Compose passes the same value to both).
 *                             For `base` and `small` models each window is sent with whisper.cpp's audio context
 *                             sized to it (2 to 3 times faster); other models, and an unset name, get the full 30 s.
 *   WHISPER_FIT_AUDIO_CTX     1 or 0 overrides that choice
 *   WHISPER_BIN / WHISPER_MODEL / WHISPER_THREADS   a local whisper.cpp binary (default whisper-cli)
 *   OLLAMA_URL / OLLAMA_MODEL   the local LLM (default http://127.0.0.1:11434; model required). A model that is
 *                       not in Ollama yet is downloaded at start-up, in the background; summaries wait for it
 *   OLLAMA_STORY_MODEL  the model that tells the tale from the notes (the bard). Unset: OLLAMA_MODEL does both.
 *   OLLAMA_KEEP_ALIVE   how long Ollama keeps the model loaded after a request (e.g. 2m; unset: the
 *                       Ollama server's own setting)
 *   WORKER_ID           this worker's stable name (default: the hostname). A restarted worker with the
 *                       same id takes back its own interrupted job at once instead of waiting out the
 *                       5-minute lease; never give two running workers the same id
 *   WHISPER_API_KEY / LLM_API_KEY   only if a remote backend needs one
 *   ANTHROPIC_API_KEY               only for ai.llm.kind claude
 *   OPENAI_API_KEY                  only for ai.llm.kind openai
 *   RECORDINGS_DIR      where the audio files live (needed to delete raw audio)
 *   RECORDING_RETENTION_DAYS   delete the raw audio of processed recordings after this many days
 *                       (0 or unset: keep it for ever; `vtt-admin recording purge` still works)
 *   AUDIO_DISK_PURGE    0 turns off the disk rule: below 10% free on the recordings disk the DM is warned,
 *                       and 3 days later the oldest unconfirmed audio is deleted (under 3% free: no wait)
 *
 *   node ai/dist/cli/worker.js [--once]     --once: drain the queue, then exit
 */
import {
  BARD_SAMPLING,
  DEFAULT_OLLAMA_URL,
  SCRIBE_SAMPLING,
  type Sampling,
} from '../consts/index.js';
import { rmdir, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

import { PostgresJobQueue } from '../lib/jobs/postgresQueue.js';
import { processNext, resolveWorkerId, runWorker } from '../lib/jobs/worker.js';
import {
  holdForModel,
  holdForWhisper,
  keepTrying,
  OllamaModelKeeper,
  WhisperReadiness,
} from '../lib/localAi/keepers.js';
import { createLocalAiReporter, reportWorst, writeLocalAiStatus } from '../lib/localAi/status.js';
import type { GenerateText } from '../types/index.js';
import { createOllamaGenerate } from '../lib/ollama.js';
import { PostgresRecordsStore, createPool } from '../lib/records/postgresRecordsStore.js';
import {
  createProcessRecordingHandler,
  PROCESS_RECORDING_JOB,
} from '../lib/records/processRecording.js';
import {
  createDeleteRecordingHandler,
  createPurgeRecordingHandler,
  DELETE_RECORDING_JOB,
  insideDirectory,
  PURGE_RECORDING_JOB,
  scheduleRetentionPurges,
} from '../lib/records/purgeRecording.js';
import { freePercentOf, sweepDiskPurges } from '../lib/records/diskPurge.js';
import { transcribeTrackFile } from '../lib/records/transcribeTrack.js';
import { createOpenAiTranscribe, fitsAudioContext } from '../lib/providers/openaiCompat.js';
import { transcribeWavWithWhisperCli } from '../lib/whisperCli.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Fitted audio context: the operator's explicit choice, else by the model's name (lib/providers/openaiCompat.ts). */
function fitAudioContext(env: NodeJS.ProcessEnv): boolean {
  if (env.WHISPER_FIT_AUDIO_CTX === '1') return true;
  if (env.WHISPER_FIT_AUDIO_CTX === '0') return false;
  return fitsAudioContext(env.WHISPER_MODEL_FILE);
}

async function main(): Promise<void> {
  const pool = createPool(required('DATABASE_URL'));
  const localUrl = process.env.WHISPER_LOCAL_URL;
  const modelPath = localUrl ? '' : required('WHISPER_MODEL');
  const threads = process.env.WHISPER_THREADS ? Number(process.env.WHISPER_THREADS) : undefined;
  const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

  const once = process.argv.includes('--once');
  const abort = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => abort.abort());

  // The local AI may not be ready when the worker starts: on a first start the Whisper container is still fetching
  // its model, and the summary model is fetched here (lib/localAi/keepers.ts). Neither holds up start-up; the state
  // goes to the database for the status page and `vtt-admin status`, and a job waits only for the part it needs.
  const reporter = createLocalAiReporter({ write: (status) => writeLocalAiStatus(pool, status) });
  const ollamaUrl = process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
  const ollamaModel = required('OLLAMA_MODEL');
  // Two roles, one or two models (lib/prompts.ts): the scribe takes the notes, the bard tells the tale from them.
  const storyModel = process.env.OLLAMA_STORY_MODEL || ollamaModel;
  const twoModels = storyModel !== ollamaModel;
  const [reportScribe, reportBard] = reportWorst(reporter.llm, twoModels ? 2 : 1);
  const keeperFor = (model: string, report: typeof reporter.llm): OllamaModelKeeper =>
    new OllamaModelKeeper({ baseUrl: ollamaUrl, model, report, signal: abort.signal, log });
  const modelKeeper = keeperFor(ollamaModel, reportScribe ?? reporter.llm);
  const storyKeeper = twoModels ? keeperFor(storyModel, reportBard ?? reporter.llm) : modelKeeper;
  const ollamaGenerate = (model: string, sampling: Sampling): GenerateText =>
    createOllamaGenerate({
      model,
      baseUrl: ollamaUrl,
      numCtx: 8192,
      sampling,
      ...(process.env.OLLAMA_KEEP_ALIVE ? { keepAlive: process.env.OLLAMA_KEEP_ALIVE } : {}),
    });
  const whisperReady = localUrl
    ? new WhisperReadiness({ baseUrl: localUrl, report: reporter.whisper, log })
    : undefined;
  const hold = { signal: abort.signal };

  const handler = createProcessRecordingHandler({
    records: new PostgresRecordsStore(pool),
    localTranscribe: (language, prompt) =>
      localUrl && whisperReady
        ? holdForWhisper(
            createOpenAiTranscribe({
              baseUrl: localUrl,
              model: 'whisper-1',
              language,
              ...(prompt ? { prompt } : {}),
              // The local Whisper is whisper.cpp: have it encode only as much audio as each window holds, when the
              // model is one that was measured to cope (not turbo: it repeats itself).
              fitAudioContext: fitAudioContext(process.env),
            }),
            whisperReady,
            hold,
          )
        : (wav) =>
            transcribeWavWithWhisperCli(wav, wav.replace(/\.wav$/, ''), {
              ...(process.env.WHISPER_BIN ? { bin: process.env.WHISPER_BIN } : {}),
              modelPath,
              ...(threads ? { threads } : {}),
              language,
              ...(prompt ? { prompt } : {}),
            }),
    // The bard always gets its own generator: the same model may be both, but it samples differently.
    localGenerate: holdForModel(ollamaGenerate(ollamaModel, SCRIBE_SAMPLING), modelKeeper, hold),
    localStory: holdForModel(ollamaGenerate(storyModel, BARD_SAMPLING), storyKeeper, hold),
    transcribeAudioFile: (file, transcribeWav) => transcribeTrackFile(file, transcribeWav),
    env: process.env,
    log,
  });

  const records = new PostgresRecordsStore(pool);
  const queue = new PostgresJobQueue(pool);
  const recordingsDir = process.env.RECORDINGS_DIR;
  const deleteFile = async (file: string): Promise<boolean> => {
    if (!recordingsDir || !insideDirectory(recordingsDir, file)) {
      throw new Error(`refusing to delete ${file}: it is not under RECORDINGS_DIR`);
    }
    try {
      await unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    // The recording's folder, once it is empty.
    await rmdir(path.dirname(file)).catch(() => undefined);
    return true;
  };
  const purge = createPurgeRecordingHandler({ records, deleteFile, log });
  const removeRecording = createDeleteRecordingHandler({ records, deleteFile, log });
  const workerId = resolveWorkerId(process.env, hostname());
  const options = {
    queue,
    workerId,
    handlers: {
      [PROCESS_RECORDING_JOB]: handler,
      [PURGE_RECORDING_JOB]: purge,
      [DELETE_RECORDING_JOB]: removeRecording,
    },
    log,
  };
  const retentionDays = Number(process.env.RECORDING_RETENTION_DAYS ?? 0);
  // The disk rule (decided 2026-11-10): when the recordings disk runs low, warn the DM and then delete the
  // oldest unconfirmed audio. On by default; AUDIO_DISK_PURGE=0 turns it off.
  const diskRule = recordingsDir !== undefined && process.env.AUDIO_DISK_PURGE !== '0';
  const sweep = (): void => {
    scheduleRetentionPurges({ records, queue, days: retentionDays })
      .then((n) => n > 0 && log(`retention: queued ${n} purge(s) of raw audio`))
      .catch((error: unknown) => log(`retention sweep failed: ${String(error)}`));
    if (!diskRule || recordingsDir === undefined) return;
    freePercentOf(recordingsDir)
      .then(async (freePercent) => {
        if (freePercent === undefined) return;
        const done = await sweepDiskPurges({ records, queue, freePercent });
        if (done.notified + done.purged > 0) {
          log(
            `disk ${freePercent.toFixed(1)}% free: warned ${done.notified} DM(s), queued ${done.purged} purge(s)`,
          );
        }
      })
      .catch((error: unknown) => log(`disk sweep failed: ${String(error)}`));
  };
  /**
   * Whether this install will ever use the local LLM: not when summaries go to a remote server and falling back to
   * local is switched off. Then the model is not downloaded (it would be gigabytes nobody uses); a job that needs
   * it after all, because the setting changed, still fetches it on demand.
   */
  const usesLocalLlm = async (): Promise<boolean> => {
    try {
      const ai = await records.getAiSettings();
      return !(ai.llm.kind === 'remote' && ai.llm.url !== null && !ai.fallback.enabled);
    } catch {
      return true; // the database is not ready yet (a first start): assume the default, which is local
    }
  };

  try {
    if (once) {
      while (await processNext(options)) {
        /* drain */
      }
    } else {
      log(`records worker started (id ${workerId})`);
      if (retentionDays > 0) {
        log(`raw audio is deleted ${retentionDays} day(s) after a recording is processed`);
      }
      if (diskRule)
        log('raw audio is deleted, after a 3-day warning, when the disk runs below 10% free');
      if (retentionDays > 0 || diskRule) {
        sweep();
        setInterval(sweep, 3_600_000).unref();
      }
      if (whisperReady) void keepTrying(whisperReady, { signal: abort.signal });
      void usesLocalLlm().then((wanted) => {
        if (!wanted) {
          log(`summaries use the remote LLM only: not downloading the local model ${ollamaModel}`);
          return undefined;
        }
        // One after the other: two multi-gigabyte downloads at once only slow each other down.
        return keepTrying(modelKeeper, { signal: abort.signal }).then(() =>
          twoModels ? keepTrying(storyKeeper, { signal: abort.signal }) : undefined,
        );
      });
      await runWorker({ ...options, signal: abort.signal });
    }
  } finally {
    // Also when the job loop died (the database went away): the background model checks must not keep a worker
    // alive that no longer takes jobs. It exits, and the service manager starts a fresh one.
    abort.abort();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
