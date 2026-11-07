export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** Two utterances by the same speaker closer together than this are joined into one line. */
export const DEFAULT_COALESCE_GAP_MS = 1_500;

/**
 * How much transcript goes into one model call. Characters, not tokens: cheap and
 * model-agnostic. ~24k chars is roughly 6k tokens, which leaves room for the prompt and the
 * answer inside a modest context window on a CPU-only server.
 */
export const DEFAULT_CHUNK_CHARS = 24_000;
export const DEFAULT_CHUNK_OVERLAP_LINES = 4;

/** Map-reduce gives up recursing past this many levels rather than loop on a stubborn model. */
export const MAX_REDUCE_DEPTH = 4;

// --- Speech-window segmentation (lib/speechWindows.ts) -----------------------------------------
// Chosen from the 2026-11-07 spike (AUDIO-SPIKE-RESULTS.md, Finding 4); accuracy over speed.

/** Below this level (dBFS) counts as silence. Conservative: a quiet player must not be clipped. */
export const DEFAULT_SILENCE_NOISE_DB = -40;
/** A quiet stretch must last this long to split speech; short pauses stay inside a window. */
export const DEFAULT_MIN_SILENCE_SEC = 0.7;
export const DEFAULT_MIN_SPEECH_MS = 300;
export const DEFAULT_PAD_MS = 400;
/** Compared after padding. Speech closer together than this is transcribed as one window. */
export const DEFAULT_MERGE_GAP_MS = 2_000;
/** Whisper's native context is 30 s; 60 s keeps sentences intact without long-form drift. */
export const DEFAULT_MAX_WINDOW_MS = 60_000;
