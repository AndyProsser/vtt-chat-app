/**
 * What the worker knows about the local AI it depends on (the Whisper server and the summary model in Ollama).
 * Written to the database by the worker and read by the status page and `vtt-admin status`, so a first-start
 * model download, or one that failed, is visible without reading container logs.
 */
export type LocalModelState =
  /** There and answering. */
  | 'ready'
  /** The model is being fetched (first start, or after the operator changed it). */
  | 'downloading'
  /** The service is not answering (still starting, stopped, or not part of this install). */
  | 'waiting'
  /** The last download attempt failed; the worker tries again with a growing pause. */
  | 'failed';

export interface LocalModelStatus {
  state: LocalModelState;
  /** 0 to 100, while downloading. */
  percent?: number;
  /** For the operator (logs, `vtt-admin status`). Never shown on the public status page. */
  detail?: string;
}

/**
 * What the worker last found out, by asking Ollama directly, about the configured LLM backend's real
 * context window — for `vtt-admin status` to grade against what the app assumes (`contextWindowTokens`).
 * `local`/`remote` only: `claude`/`openai` are graded from a built-in table instead (ai/consts/claude.ts),
 * so no check is ever stored for them.
 */
export interface OllamaContextStatus {
  kind: 'local' | 'remote';
  /** The model this was checked against; absent for `remote` with no model configured. */
  model: string | null;
  /** From `/api/ps`: what the currently-loaded instance is actually being served. Absent if not loaded. */
  live?: number;
  /** From `/api/show`: the model's own trained maximum. Absent if the model is unknown to Ollama. */
  modelMax?: number;
  /** True when neither endpoint could be reached at all (not just "model not loaded"). */
  unreachable: boolean;
  /** When this check ran, set by the caller (the worker) — its own timestamp, never `LocalAiStatus.at`. */
  checkedAt: number;
}

export interface LocalAiStatus {
  /** When the worker last wrote this. A "downloading" that stops being refreshed has stalled. */
  at: number;
  /** The summary model in the local Ollama. */
  llm: LocalModelStatus | null;
  /** The local Whisper server; null when the worker runs a whisper.cpp binary itself (native install). */
  whisper: LocalModelStatus | null;
  /** The configured LLM backend's real context window, as last determined. */
  llmContext?: OllamaContextStatus | null;
}
