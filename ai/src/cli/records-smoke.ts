/**
 * Stage 2 Part B smoke test: per-speaker audio files → ffmpeg → whisper.cpp → merged,
 * speaker-attributed transcript → Ollama summary, with timings for sizing the server.
 *
 * Throwaway-grade on purpose (ROADMAP Stage 2): it proves the chain and measures it. Stage 5
 * turns the same library functions into a retryable job queue.
 *
 *   node dist/cli/records-smoke.js --tracks <dir> --model <ggml-model.bin> --ollama-model <name> [options]
 *
 * Track files are named `<speakerId>.<ext>` or `<speakerId>@<startOffsetMs>.<ext>`
 * (offset = when that track began, relative to the recording start).
 * Optional `--names names.json` maps speakerId → display name (e.g. the character name).
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { DEFAULT_OLLAMA_URL } from '../consts/index.js';
import { detectSilences, extractWindowWav, probeDurationMs } from '../lib/ffmpeg.js';
import { formatTranscript } from '../lib/format.js';
import { mergeTranscripts } from '../lib/merge.js';
import { createOllamaGenerate } from '../lib/ollama.js';
import { speechWindows, transcribeWindows } from '../lib/speechWindows.js';
import { summarise } from '../lib/summarise.js';
import { transcribeWavWithWhisperCli } from '../lib/whisperCli.js';
import type { Segment, SummaryKind, TrackTranscript } from '../types/index.js';

const run = promisify(execFile);

const AUDIO_EXTENSIONS = new Set([
  '.ogg',
  '.opus',
  '.wav',
  '.mp3',
  '.m4a',
  '.flac',
  '.webm',
  '.mp4',
]);

export interface TrackFileName {
  speakerId: string;
  startOffsetMs: number;
}

/** `alice.ogg` → alice @ 0; `alice@12000.ogg` → alice @ 12000. Returns null for non-audio files. */
export function parseTrackFileName(fileName: string): TrackFileName | null {
  const ext = path.extname(fileName).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) return null;
  const stem = path.basename(fileName, path.extname(fileName));
  const at = stem.lastIndexOf('@');
  if (at === -1) return { speakerId: stem, startOffsetMs: 0 };
  const offset = Number(stem.slice(at + 1));
  if (!Number.isFinite(offset) || offset < 0) return null;
  return { speakerId: stem.slice(0, at), startOffsetMs: offset };
}

async function seconds<T>(work: () => Promise<T>): Promise<{ value: T; seconds: number }> {
  const start = performance.now();
  const value = await work();
  return { value, seconds: (performance.now() - start) / 1000 };
}

async function audioDurationSeconds(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  return Number(stdout.trim());
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tracks: { type: 'string' },
      model: { type: 'string' },
      'ollama-model': { type: 'string' },
      'ollama-url': { type: 'string', default: DEFAULT_OLLAMA_URL },
      'whisper-bin': { type: 'string' },
      names: { type: 'string' },
      out: { type: 'string', default: 'records-smoke-out' },
      kind: { type: 'string', default: 'session' },
      threads: { type: 'string' },
      language: { type: 'string' },
      'noise-db': { type: 'string' },
      'whole-track': { type: 'boolean', default: false },
    },
  });

  if (!values.tracks || !values.model || !values['ollama-model']) {
    throw new Error('required: --tracks <dir> --model <whisper ggml model> --ollama-model <name>');
  }
  const kind = values.kind as SummaryKind;
  if (!['session', 'dm-only', 'character'].includes(kind)) {
    throw new Error(`--kind must be session, dm-only or character (got "${values.kind}")`);
  }

  const out = path.resolve(values.out ?? 'records-smoke-out');
  await mkdir(out, { recursive: true });
  const names: Record<string, string> = values.names
    ? (JSON.parse(await readFile(values.names, 'utf8')) as Record<string, string>)
    : {};

  const files = (await readdir(values.tracks))
    .map((fileName) => ({ fileName, parsed: parseTrackFileName(fileName) }))
    .filter((entry): entry is { fileName: string; parsed: TrackFileName } => entry.parsed !== null);
  if (files.length === 0) throw new Error(`no audio files found in ${values.tracks}`);

  const timings: Record<string, unknown>[] = [];
  const tracks: TrackTranscript[] = [];

  for (const { fileName, parsed } of files) {
    const source = path.join(values.tracks, fileName);
    const wav = path.join(out, `${parsed.speakerId}.16k.wav`);
    const jsonBase = path.join(out, parsed.speakerId);

    const whisper = {
      ...(values['whisper-bin'] ? { bin: values['whisper-bin'] } : {}),
      modelPath: values.model,
      ...(values.threads ? { threads: Number(values.threads) } : {}),
      ...(values.language ? { language: values.language } : {}),
    };

    let segments: Segment[];
    let duration: number;
    let transcodeSeconds = 0;
    let transcribeSeconds: number;
    let windowCount = 1;
    let speechSeconds: number;

    if (values['whole-track']) {
      // The old behaviour, kept for comparison: Whisper over the entire track.
      const transcode = await seconds(() =>
        run('ffmpeg', ['-y', '-v', 'error', '-i', source, '-ar', '16000', '-ac', '1', wav]),
      );
      transcodeSeconds = transcode.seconds;
      duration = await audioDurationSeconds(wav);
      speechSeconds = duration;
      const transcribe = await seconds(() => transcribeWavWithWhisperCli(wav, jsonBase, whisper));
      transcribeSeconds = transcribe.seconds;
      segments = transcribe.value;
    } else {
      // Segment into speech windows, transcribe each, and put the timestamps back (speechWindows.ts).
      const durationMs = await probeDurationMs(source);
      duration = durationMs / 1000;
      const silences = await detectSilences(source, durationMs, {
        ...(values['noise-db'] ? { noiseDb: Number(values['noise-db']) } : {}),
      });
      const windows = speechWindows(silences, durationMs);
      windowCount = windows.length;
      speechSeconds = windows.reduce((sum, w) => sum + (w.endMs - w.startMs), 0) / 1000;
      const windowDir = path.join(out, `${parsed.speakerId}-windows`);
      await mkdir(windowDir, { recursive: true });
      const transcribe = await seconds(() =>
        transcribeWindows(windows, {
          transcribeWindow: async (window, index) => {
            const base = path.join(windowDir, String(index).padStart(4, '0'));
            await extractWindowWav(source, window, `${base}.wav`);
            return transcribeWavWithWhisperCli(`${base}.wav`, base, whisper);
          },
          onProgress: (done, total) => {
            if (done === total || done % 25 === 0) {
              console.log(`  ${parsed.speakerId}: window ${done}/${total}`);
            }
          },
        }),
      );
      transcribeSeconds = transcribe.seconds;
      segments = transcribe.value;
    }

    tracks.push({
      speaker: { id: parsed.speakerId, name: names[parsed.speakerId] ?? parsed.speakerId },
      startOffsetMs: parsed.startOffsetMs,
      segments,
    });

    timings.push({
      speaker: parsed.speakerId,
      mode: values['whole-track'] ? 'whole-track' : 'speech-windows',
      audioSeconds: duration,
      speechSeconds,
      windows: windowCount,
      transcodeSeconds,
      transcribeSeconds,
      // Below 1.0 = faster than real time. Against the whole track, and against speech only.
      whisperRealTimeFactor: transcribeSeconds / duration,
      whisperRealTimeFactorOnSpeech: transcribeSeconds / Math.max(speechSeconds, 1),
      segments: segments.length,
    });
    console.log(
      `${parsed.speakerId}: ${duration.toFixed(0)} s audio (${speechSeconds.toFixed(0)} s speech, ` +
        `${windowCount} window(s)), whisper ${transcribeSeconds.toFixed(1)} s ` +
        `(RTF ${(transcribeSeconds / duration).toFixed(2)}), ${segments.length} segments`,
    );
  }

  const utterances = mergeTranscripts(tracks);
  await writeFile(path.join(out, 'transcript.txt'), `${formatTranscript(utterances).join('\n')}\n`);

  const generate = createOllamaGenerate({
    model: values['ollama-model'],
    baseUrl: values['ollama-url'],
    numCtx: 8192,
  });
  const summary = await seconds(() => summarise(generate, utterances, { kind }));
  await writeFile(path.join(out, `summary-${kind}.md`), `${summary.value.text}\n`);
  timings.push({ summariseSeconds: summary.seconds, modelCalls: summary.value.modelCalls });
  console.log(
    `summary: ${summary.value.modelCalls} model call(s), ${summary.seconds.toFixed(1)} s → summary-${kind}.md`,
  );

  await writeFile(path.join(out, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`);
  console.log(`wrote transcript.txt, summary-${kind}.md and timings.json to ${out}`);
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
