import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Segment, TranscribeWav } from '../../types/index.js';
import {
  detectSilences,
  extractWindowWav,
  probeDurationMs,
  type SilenceOptions,
} from '../ffmpeg.js';
import { speechWindows, transcribeWindows, type WindowOptions } from '../speechWindows.js';

export interface TranscribeTrackOptions {
  silence?: SilenceOptions;
  windows?: WindowOptions;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Transcribes one track file: find the speech windows, cut each to a temporary WAV, transcribe it
 * with `transcribeWav` (local or remote), and return segments on the track's own timeline. The
 * temporary files are removed whatever happens.
 */
export async function transcribeTrackFile(
  file: string,
  transcribeWav: TranscribeWav,
  options: TranscribeTrackOptions = {},
): Promise<Segment[]> {
  const durationMs = await probeDurationMs(file);
  const silences = await detectSilences(file, durationMs, options.silence);
  const windows = speechWindows(silences, durationMs, options.windows);
  if (windows.length === 0) return [];

  const dir = await mkdtemp(path.join(tmpdir(), 'vtt-track-'));
  try {
    return await transcribeWindows(windows, {
      transcribeWindow: async (window, index) => {
        const wav = path.join(dir, `${String(index).padStart(5, '0')}.wav`);
        await extractWindowWav(file, window, wav);
        const segments = await transcribeWav(wav);
        await rm(wav, { force: true });
        return segments;
      },
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
