import {
  DEFAULT_MAX_WINDOW_MS,
  DEFAULT_MERGE_GAP_MS,
  DEFAULT_MIN_SPEECH_MS,
  DEFAULT_PAD_MS,
} from '../consts/index.js';
import type { Segment } from '../types/index.js';

/** A stretch of one track, in milliseconds from the start of that track's audio. */
export interface TimeSpan {
  startMs: number;
  endMs: number;
}

export interface WindowOptions {
  /** Speech shorter than this between two silences is treated as a click or breath, not speech. */
  minSpeechMs?: number;
  /** Context added either side of speech, so a quiet word onset or tail isn't clipped. */
  padMs?: number;
  /** Speech separated by less than this is one window: a conversation, not separate utterances. */
  mergeGapMs?: number;
  /** A window never exceeds this; longer speech is cut into equal parts. */
  maxWindowMs?: number;
}

/**
 * Reads ffmpeg `silencedetect` output (it prints to stderr) into silent intervals.
 *
 *   [silencedetect @ 0x…] silence_start: 15.999937
 *   [silencedetect @ 0x…] silence_end: 65.106 | silence_duration: 49.106
 *
 * A `silence_start` with no matching `silence_end` means the track ended in silence, so that
 * interval runs to `durationMs`.
 */
export function parseSilenceDetect(stderr: string, durationMs: number): TimeSpan[] {
  const silences: TimeSpan[] = [];
  let openStart: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start?.[1] !== undefined) {
      // ffmpeg can report a slightly negative start for a track that begins silent.
      openStart = Math.max(0, Math.round(Number(start[1]) * 1000));
      continue;
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end?.[1] !== undefined && openStart !== undefined) {
      silences.push({ startMs: openStart, endMs: Math.round(Number(end[1]) * 1000) });
      openStart = undefined;
    }
  }
  if (openStart !== undefined && openStart < durationMs) {
    silences.push({ startMs: openStart, endMs: durationMs });
  }
  return silences.map((s) => ({
    startMs: Math.min(s.startMs, durationMs),
    endMs: Math.min(s.endMs, durationMs),
  }));
}

/** Everything in `[0, durationMs]` that is not inside a silent interval. */
export function invert(silences: TimeSpan[], durationMs: number): TimeSpan[] {
  const sorted = [...silences].sort((a, b) => a.startMs - b.startMs);
  const speech: TimeSpan[] = [];
  let cursor = 0;
  for (const silence of sorted) {
    if (silence.startMs > cursor) speech.push({ startMs: cursor, endMs: silence.startMs });
    cursor = Math.max(cursor, silence.endMs);
  }
  if (cursor < durationMs) speech.push({ startMs: cursor, endMs: durationMs });
  return speech;
}

/**
 * Turns the silent intervals of one track into the windows worth transcribing.
 *
 * Why this exists instead of handing Whisper the whole track (AUDIO-SPIKE-RESULTS.md, Finding 4):
 * whole-track transcription spends most of its time on silence, invents text on room noise, and
 * reported speech after 12 s of silence as starting at 0 s — which breaks the merge order across
 * speakers. Cutting windows ourselves means every Whisper timestamp is relative to a window whose
 * start we know exactly.
 *
 * Steps: invert silence → drop blips → pad → merge near neighbours (without exceeding the
 * maximum window) → split any single stretch that is still too long.
 */
export function speechWindows(
  silences: TimeSpan[],
  durationMs: number,
  options: WindowOptions = {},
): TimeSpan[] {
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  const padMs = options.padMs ?? DEFAULT_PAD_MS;
  const mergeGapMs = options.mergeGapMs ?? DEFAULT_MERGE_GAP_MS;
  const maxWindowMs = options.maxWindowMs ?? DEFAULT_MAX_WINDOW_MS;

  const padded = invert(silences, durationMs)
    .filter((s) => s.endMs - s.startMs >= minSpeechMs)
    .map((s) => ({
      startMs: Math.max(0, s.startMs - padMs),
      endMs: Math.min(durationMs, s.endMs + padMs),
    }));

  const merged: TimeSpan[] = [];
  for (const span of padded) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      span.startMs - last.endMs < mergeGapMs &&
      span.endMs - last.startMs <= maxWindowMs
    ) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else if (last !== undefined && span.startMs < last.endMs) {
      // Padding made two neighbours overlap but merging would exceed the maximum: meet in the middle.
      const middle = Math.round((last.endMs + span.startMs) / 2);
      last.endMs = middle;
      merged.push({ startMs: middle, endMs: span.endMs });
    } else {
      merged.push({ ...span });
    }
  }

  return merged.flatMap((span) => splitLong(span, maxWindowMs));
}

/** Cuts a stretch longer than `maxWindowMs` into equal parts, each at most `maxWindowMs`. */
function splitLong(span: TimeSpan, maxWindowMs: number): TimeSpan[] {
  const length = span.endMs - span.startMs;
  if (length <= maxWindowMs) return [span];
  const parts = Math.ceil(length / maxWindowMs);
  const size = length / parts;
  return Array.from({ length: parts }, (_, i) => ({
    startMs: Math.round(span.startMs + i * size),
    endMs: Math.round(span.startMs + (i + 1) * size),
  }));
}

/** Turns one window's transcription (times relative to the window) into track-relative segments. */
export function offsetSegments(segments: Segment[], window: TimeSpan): Segment[] {
  return segments.map((s) => ({
    startMs: window.startMs + s.startMs,
    // Whisper can report an end past the audio it was given; never claim speech beyond the window.
    endMs: Math.min(window.startMs + s.endMs, window.endMs),
    text: s.text,
  }));
}

export interface TranscribeWindowsDeps {
  /** Transcribes the audio of one window; segment times are relative to that window's start. */
  transcribeWindow: (window: TimeSpan, index: number) => Promise<Segment[]>;
  /** Called after each window, for progress reporting on a long job. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Transcribes a track window by window and returns segments on the track's own timeline, in order.
 * A failing window fails the whole track: a transcript with a silent hole in it is worse than an
 * error the job queue can retry.
 */
export async function transcribeWindows(
  windows: TimeSpan[],
  deps: TranscribeWindowsDeps,
): Promise<Segment[]> {
  const out: Segment[] = [];
  for (const [index, window] of windows.entries()) {
    const segments = await deps.transcribeWindow(window, index);
    out.push(...offsetSegments(segments, window));
    deps.onProgress?.(index + 1, windows.length);
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}
