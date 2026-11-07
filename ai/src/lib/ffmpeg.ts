import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { DEFAULT_MIN_SILENCE_SEC, DEFAULT_SILENCE_NOISE_DB } from '../consts/index.js';
import { parseSilenceDetect, type TimeSpan } from './speechWindows.js';

const execFileAsync = promisify(execFile);
/** ffmpeg prints silencedetect to stderr; a 4-hour track yields a lot of lines. */
const MAX_BUFFER = 64 * 1024 * 1024;

export async function probeDurationMs(file: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`could not read the duration of ${file}`);
  return Math.round(seconds * 1000);
}

export interface SilenceOptions {
  noiseDb?: number;
  minSilenceSec?: number;
}

/** The silent intervals of `file`, found with ffmpeg's `silencedetect`. */
export async function detectSilences(
  file: string,
  durationMs: number,
  options: SilenceOptions = {},
): Promise<TimeSpan[]> {
  const noise = options.noiseDb ?? DEFAULT_SILENCE_NOISE_DB;
  const minSilence = options.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC;
  const { stderr } = await execFileAsync(
    'ffmpeg',
    [
      '-v',
      'info',
      '-nostats',
      '-i',
      file,
      '-af',
      `silencedetect=n=${noise}dB:d=${minSilence}`,
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: MAX_BUFFER },
  );
  return parseSilenceDetect(stderr, durationMs);
}

/** Cuts `window` out of `file` as 16 kHz mono WAV, the format Whisper wants. */
export async function extractWindowWav(
  file: string,
  window: TimeSpan,
  outFile: string,
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-v',
    'error',
    // -ss after -i: slower but sample-accurate, which the offsets depend on.
    '-i',
    file,
    '-ss',
    (window.startMs / 1000).toFixed(3),
    '-t',
    ((window.endMs - window.startMs) / 1000).toFixed(3),
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    outFile,
  ]);
}
