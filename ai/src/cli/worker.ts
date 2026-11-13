#!/usr/bin/env node
/**
 * The records worker: claims `process-recording` jobs from Postgres and runs them (transcribe →
 * merge → summarise). Configuration is the environment; *where* Whisper and the LLM run (local or a
 * remote OpenAI-compatible server) is the operator's AI setting, read per job from the database.
 *
 *   DATABASE_URL        Postgres (required)
 *   WHISPER_LOCAL_URL   the local Whisper as an OpenAI-compatible server (the Compose bundle's `whisper`), OR
 *   WHISPER_BIN / WHISPER_MODEL / WHISPER_THREADS   a local whisper.cpp binary (default whisper-cli)
 *   OLLAMA_URL / OLLAMA_MODEL   the local LLM (default http://127.0.0.1:11434; model required)
 *   OLLAMA_KEEP_ALIVE   how long Ollama keeps the model loaded after a request (e.g. 2m; unset: the
 *                       Ollama server's own setting)
 *   WORKER_ID           this worker's stable name (default: the hostname). A restarted worker with the
 *                       same id takes back its own interrupted job at once instead of waiting out the
 *                       5-minute lease; never give two running workers the same id
 *   WHISPER_API_KEY / LLM_API_KEY   only if a remote backend needs one
 *   RECORDINGS_DIR      where the audio files live (needed to delete raw audio)
 *   RECORDING_RETENTION_DAYS   delete the raw audio of processed recordings after this many days
 *                       (0 or unset: keep it for ever; `vtt-admin recording purge` still works)
 *   AUDIO_DISK_PURGE    0 turns off the disk rule: below 10% free on the recordings disk the DM is warned,
 *                       and 3 days later the oldest unconfirmed audio is deleted (under 3% free: no wait)
 *
 *   node ai/dist/cli/worker.js [--once]     --once: drain the queue, then exit
 */
import { DEFAULT_OLLAMA_URL } from '../consts/index.js';
import { rmdir, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

import { PostgresJobQueue } from '../lib/jobs/postgresQueue.js';
import { processNext, resolveWorkerId, runWorker } from '../lib/jobs/worker.js';
import { createOllamaGenerate } from '../lib/ollama.js';
import { PostgresRecordsStore, createPool } from '../lib/records/postgresRecordsStore.js';
import {
  createProcessRecordingHandler,
  PROCESS_RECORDING_JOB,
} from '../lib/records/processRecording.js';
import {
  createPurgeRecordingHandler,
  insideDirectory,
  PURGE_RECORDING_JOB,
  scheduleRetentionPurges,
} from '../lib/records/purgeRecording.js';
import { freePercentOf, sweepDiskPurges } from '../lib/records/diskPurge.js';
import { transcribeTrackFile } from '../lib/records/transcribeTrack.js';
import { createOpenAiTranscribe } from '../lib/providers/openaiCompat.js';
import { transcribeWavWithWhisperCli } from '../lib/whisperCli.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const pool = createPool(required('DATABASE_URL'));
  const localUrl = process.env.WHISPER_LOCAL_URL;
  const modelPath = localUrl ? '' : required('WHISPER_MODEL');
  const threads = process.env.WHISPER_THREADS ? Number(process.env.WHISPER_THREADS) : undefined;
  const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

  const handler = createProcessRecordingHandler({
    records: new PostgresRecordsStore(pool),
    localTranscribe: (language) =>
      localUrl
        ? createOpenAiTranscribe({ baseUrl: localUrl, model: 'whisper-1', language })
        : (wav) =>
            transcribeWavWithWhisperCli(wav, wav.replace(/\.wav$/, ''), {
              ...(process.env.WHISPER_BIN ? { bin: process.env.WHISPER_BIN } : {}),
              modelPath,
              ...(threads ? { threads } : {}),
              language,
            }),
    localGenerate: createOllamaGenerate({
      model: required('OLLAMA_MODEL'),
      baseUrl: process.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
      numCtx: 8192,
      ...(process.env.OLLAMA_KEEP_ALIVE ? { keepAlive: process.env.OLLAMA_KEEP_ALIVE } : {}),
    }),
    transcribeAudioFile: (file, transcribeWav) => transcribeTrackFile(file, transcribeWav),
    env: process.env,
    log,
  });

  const records = new PostgresRecordsStore(pool);
  const queue = new PostgresJobQueue(pool);
  const recordingsDir = process.env.RECORDINGS_DIR;
  const purge = createPurgeRecordingHandler({
    records,
    deleteFile: async (file) => {
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
    },
    log,
  });
  const workerId = resolveWorkerId(process.env, hostname());
  const options = {
    queue,
    workerId,
    handlers: { [PROCESS_RECORDING_JOB]: handler, [PURGE_RECORDING_JOB]: purge },
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
  const once = process.argv.includes('--once');
  const abort = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => abort.abort());

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
      await runWorker({ ...options, signal: abort.signal });
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
