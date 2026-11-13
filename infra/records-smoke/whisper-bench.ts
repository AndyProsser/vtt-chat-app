// Measures Whisper on THIS server, through the same code path the worker uses (speech windows cut by
// ffmpeg, each sent to an OpenAI-compatible whisper-server): real-time factor, word accuracy against a
// known script, and peak memory of the server's container while it ran.
//
//   node infra/records-smoke/whisper-bench.ts --url http://127.0.0.1:18080 [--container NAME] [--gpu]
//        [--label small-gpu] [--repeat 3]
//
// The test track is synthetic (piper TTS, see e2e/tts.ts) and encoded as Ogg/Opus like an Egress file:
// the scene's lines in four voices, one after another with short pauses, `--repeat` times (about 2 min
// each). Clean TTS speech flatters accuracy; use the numbers to compare models and hardware, not to
// predict a noisy real table. Start whisper-server however you like, e.g.
//   docker run --rm -d --name wb -p 18080:8080 -v <models>:/models:ro [--device nvidia.com/gpu=all] \
//     <image> /app/build/bin/whisper-server -m /models/<file> --host 0.0.0.0 --port 8080 \
//     --inference-path /v1/audio/transcriptions -l en [-t <threads>]

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createOpenAiTranscribe, probeDurationMs, transcribeTrackFile } from '@vtt-chat-app/ai';

import { CAST, RECORDING_A, RECORDING_B } from './e2e/scene.ts';
import { wordAccuracy } from './e2e/score.ts';
import { piperTts, SAMPLE_RATE } from './e2e/tts.ts';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const url = option('--url');
if (!url) throw new Error('--url <whisper-server> is required');
const container = option('--container');
const gpu = argv.includes('--gpu');
const label = option('--label', url)!;
const repeat = Number(option('--repeat', '3'));
const dir = path.join(
  process.env.E2E_STATE ?? path.join(homedir(), '.local/state/vtt-compose-e2e'),
  'bench',
);

/** The scene's spoken lines, each in its speaker's voice, joined with pauses: one long Opus track. */
async function buildTrack(): Promise<{ file: string; reference: string }> {
  const file = path.join(dir, `bench-${repeat}.ogg`);
  const lines = [...RECORDING_A, ...RECORDING_B].filter(
    (s): s is Extract<typeof s, { do: 'say' }> => s.do === 'say',
  );
  const reference = Array.from({ length: repeat }, () => lines.map((l) => l.text).join(' ')).join(
    ' ',
  );
  if (existsSync(file)) return { file, reference };
  await mkdir(dir, { recursive: true });
  const tts = piperTts(path.join(dir, '..', 'tts-cache'));
  const pause = new Int16Array(SAMPLE_RATE); // 1 s between lines
  const parts: Int16Array[] = [];
  for (let r = 0; r < repeat; r += 1) {
    for (const line of lines) {
      parts.push(await tts.render(CAST.find((c) => c.key === line.who)!.voice, line.text), pause);
    }
  }
  const total = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    total.set(p, at);
    at += p.length;
  }
  const raw = path.join(dir, 'bench.s16');
  await writeFile(raw, total);
  await run('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(SAMPLE_RATE)],
    ...['-ac', '1', '-i', raw, '-c:a', 'libopus', '-b:a', '32k', file],
  ]);
  return { file, reference };
}

/** Samples the container's memory (docker stats) and, with --gpu, the card's used VRAM. */
function sampler() {
  let peakMem = 0;
  let peakVram = 0;
  let peakCpu = 0;
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      if (container) {
        const { stdout } = await run('docker', [
          ...['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', container],
        ]).catch(() => ({ stdout: '' }));
        const [mem = '', cpu = ''] = stdout.trim().split('|');
        const m = /([\d.]+)\s*([KMG]i?B)/.exec(mem);
        if (m) {
          const unit = { KiB: 1 / 1024, MiB: 1, GiB: 1024, KB: 1 / 1000, MB: 1, GB: 1000 }[
            m[2] as 'MiB'
          ];
          peakMem = Math.max(peakMem, Number(m[1]) * (unit ?? 1));
        }
        peakCpu = Math.max(peakCpu, Number.parseFloat(cpu) || 0);
      }
      if (gpu) {
        const { stdout } = await run('nvidia-smi', [
          '--query-gpu=memory.used',
          '--format=csv,noheader,nounits',
        ]).catch(() => ({ stdout: '0' }));
        peakVram = Math.max(peakVram, Number(stdout.trim()) || 0);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const done = loop();
  return async () => {
    stopped = true;
    await done;
    return {
      peakMemMiB: Math.round(peakMem),
      peakCpuPct: Math.round(peakCpu),
      peakVramMiB: peakVram,
    };
  };
}

async function main(): Promise<void> {
  const { file, reference } = await buildTrack();
  const durationMs = await probeDurationMs(file);
  const transcribe = createOpenAiTranscribe({ baseUrl: url!, model: 'whisper-1', language: 'en' });
  // One short warm-up request, so a model load (or an idle front starting the server) is not timed.
  const clip = path.join(dir, 'warmup.wav');
  await run('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-t', '5'],
    ...['-ac', '1', '-ar', '16000', clip],
  ]);
  const warm = Date.now();
  await transcribe(clip);
  const warmupMs = Date.now() - warm;
  const stop = sampler();
  const started = Date.now();
  const segments = await transcribeTrackFile(file, transcribe);
  const elapsedMs = Date.now() - started;
  const peaks = await stop();
  const text = segments.map((s) => s.text).join(' ');
  const result = {
    label,
    audioSeconds: Math.round(durationMs / 1000),
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
    rtf: Number((elapsedMs / durationMs).toFixed(3)),
    wordAccuracy: Number(wordAccuracy(reference, text).toFixed(3)),
    segments: segments.length,
    warmupSeconds: Number((warmupMs / 1000).toFixed(1)),
    ...peaks,
  };
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
