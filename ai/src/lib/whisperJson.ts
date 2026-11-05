import type { Segment } from '../types/index.js';

interface WhisperJsonEntry {
  offsets?: { from?: unknown; to?: unknown };
  text?: unknown;
}

/** Whisper marks silence and non-speech like "[BLANK_AUDIO]", "(music)" or a bare music note. */
const NON_SPEECH = /^\s*(\[[^\]]*\]|\([^)]*\)|[♪\s]+)\s*$/u;

export function isNonSpeech(text: string): boolean {
  return text.trim() === '' || NON_SPEECH.test(text);
}

/**
 * Parses whisper.cpp's `--output-json` file into segments. Tolerant of missing fields (skips the
 * entry) but strict about the top-level shape, so a wrong file fails loudly instead of yielding
 * an empty transcript that looks like a silent session.
 */
export function parseWhisperJson(json: unknown): Segment[] {
  if (typeof json !== 'object' || json === null || !('transcription' in json)) {
    throw new Error('not a whisper.cpp JSON file: missing "transcription"');
  }
  const entries = (json as { transcription: unknown }).transcription;
  if (!Array.isArray(entries)) {
    throw new Error('not a whisper.cpp JSON file: "transcription" is not an array');
  }

  const segments: Segment[] = [];
  for (const entry of entries as WhisperJsonEntry[]) {
    const from = entry.offsets?.from;
    const to = entry.offsets?.to;
    if (typeof from !== 'number' || typeof to !== 'number' || typeof entry.text !== 'string') {
      continue;
    }
    const text = entry.text.trim();
    if (isNonSpeech(text)) continue;
    segments.push({ startMs: from, endMs: to, text });
  }
  return segments;
}
