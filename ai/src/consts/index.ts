export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** Two utterances by the same speaker closer together than this are joined into one line. */
export const DEFAULT_COALESCE_GAP_MS = 1_500;

/**
 * How much transcript (or how many notes) goes into one model call. Characters, not tokens: cheap and
 * model-agnostic. ~6k chars is roughly 1.5k tokens. The scribe's notes of a piece can run nearly as long as the
 * piece itself, so input and output together must fit the 8k context the worker asks Ollama for; 24k, the size
 * before the scribe (0.5.2), would have cut long notes off. Halved from 12k (0.6.5): generation time is roughly
 * proportional to output tokens, so a smaller chunk bounds a single CPU call's worst-case wall-clock time too.
 */
export const DEFAULT_CHUNK_CHARS = 6_000;
export const DEFAULT_CHUNK_OVERLAP_LINES = 4;

/**
 * How each role samples (measured 2026-11-17, RECORDING-AND-SUMMARIES.md "Sampling"). Always sent, never left to the
 * model: `qwen3.5` ships temperature 1.0 and presence_penalty 1.5, and a presence penalty punishes every word already
 * used. Notes must repeat names and things, so the scribe drifted into run-on invention and kept 8–21 of 26 facts in a
 * 12-minute session; with these settings it keeps 24–26. The bard gets a little more freedom for its voice.
 */
export interface Sampling {
  temperature: number;
  presencePenalty: number;
}
export const SCRIBE_SAMPLING: Sampling = { temperature: 0.2, presencePenalty: 0 };
export const BARD_SAMPLING: Sampling = { temperature: 0.7, presencePenalty: 0 };

/** Map-reduce gives up recursing past this many levels rather than loop on a stubborn model. */
export const MAX_REDUCE_DEPTH = 4;

/** How many times the scribe may read one piece of transcript before the job gives up (Stage 12 D, decision 7). */
export const NOTES_READ_ATTEMPTS = 3;

/** Ollama's own measured default window when the operator has not raised it (QUALITY-VALIDATION.md, 2026-11-21). */
export const DEFAULT_LOCAL_CONTEXT_TOKENS = 8192;
/** Conservative against Claude's and OpenAI's real, much larger windows; never configured by the operator. */
export const DEFAULT_CLOUD_CONTEXT_TOKENS = 100_000;
/** What the notes are cut down to when they are too long for the tale, as a share of the window: a recap, with room left for the prompt and the answer (`fitNotes`). */
export const FIT_TARGET_SHARE = 0.45;
/** A prompt over about this share of the window takes the chunked (condense) path (the spec's own figure). */
export const CONDENSE_THRESHOLD = 0.7;

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

// --- Providers (lib/providers/) ------------------------------------------------------------------

/** A single transcription or summary call may legitimately take minutes on CPU. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15 * 60_000;
/**
 * A local Ollama generate call that hasn't finished in this long is a sign something is already
 * wrong: failing here costs 20 minutes, not `longFetch`'s full 60-minute Agent timeout, which is
 * the only other backstop a local call has.
 */
export const LOCAL_GENERATE_TIMEOUT_MS = 20 * 60_000;
/** How long to wait between attempts while a remote backend is unreachable. */
export const DEFAULT_RETRY_INTERVAL_MS = 30_000;
/** How long a remote may stay unreachable before a job falls back to local (CLAUDE.md §5). */
export const DEFAULT_FALLBACK_AFTER_MS = 10 * 60_000;
/** A segment Whisper itself thinks is probably not speech, when the server reports it. */
export const DEFAULT_MAX_NO_SPEECH_PROB = 0.8;
export * from './claude.js';
