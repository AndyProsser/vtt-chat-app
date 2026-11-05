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
import { formatTranscript } from '../lib/format.js';
import { mergeTranscripts } from '../lib/merge.js';
import { createOllamaGenerate } from '../lib/ollama.js';
import { summarise } from '../lib/summarise.js';
import { parseWhisperJson } from '../lib/whisperJson.js';
import type { SummaryKind, TrackTranscript } from '../types/index.js';

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
      'whisper-bin': { type: 'string', default: 'whisper-cli' },
      names: { type: 'string' },
      out: { type: 'string', default: 'records-smoke-out' },
      kind: { type: 'string', default: 'session' },
      threads: { type: 'string' },
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

    const transcode = await seconds(() =>
      run('ffmpeg', ['-y', '-v', 'error', '-i', source, '-ar', '16000', '-ac', '1', wav]),
    );
    const duration = await audioDurationSeconds(wav);

    const whisperArgs = ['-m', values.model, '-f', wav, '-oj', '-of', jsonBase];
    if (values.threads) whisperArgs.push('-t', values.threads);
    const transcribe = await seconds(() =>
      run(values['whisper-bin'] ?? 'whisper-cli', whisperArgs),
    );

    const segments = parseWhisperJson(JSON.parse(await readFile(`${jsonBase}.json`, 'utf8')));
    tracks.push({
      speaker: { id: parsed.speakerId, name: names[parsed.speakerId] ?? parsed.speakerId },
      startOffsetMs: parsed.startOffsetMs,
      segments,
    });

    timings.push({
      speaker: parsed.speakerId,
      audioSeconds: duration,
      transcodeSeconds: transcode.seconds,
      transcribeSeconds: transcribe.seconds,
      // Below 1.0 = faster than real time. This is the number the server sizing needs.
      whisperRealTimeFactor: transcribe.seconds / duration,
      segments: segments.length,
    });
    console.log(
      `${parsed.speakerId}: ${duration.toFixed(0)} s audio, whisper ${transcribe.seconds.toFixed(1)} s ` +
        `(RTF ${(transcribe.seconds / duration).toFixed(2)}), ${segments.length} segments`,
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
