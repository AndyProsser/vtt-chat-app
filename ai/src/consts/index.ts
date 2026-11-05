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
