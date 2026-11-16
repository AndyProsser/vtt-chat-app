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

export interface LocalAiStatus {
  /** When the worker last wrote this. A "downloading" that stops being refreshed has stalled. */
  at: number;
  /** The summary model in the local Ollama. */
  llm: LocalModelStatus | null;
  /** The local Whisper server; null when the worker runs a whisper.cpp binary itself (native install). */
  whisper: LocalModelStatus | null;
}
