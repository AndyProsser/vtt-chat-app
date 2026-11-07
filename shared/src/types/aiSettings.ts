/**
 * Where transcription and summarisation run. Decided 2026-11-07 (CLAUDE.md §5): the local backend
 * is always configured and is the fallback; a remote backend (e.g. a GPU in the operator's own PC,
 * or a cloud API) is optional, reached over the OpenAI-compatible API.
 *
 * API keys are **not** stored here — they come from the environment (`WHISPER_API_KEY`,
 * `LLM_API_KEY`), so a database dump never contains a credential.
 */
export type AiBackendKind = 'local' | 'remote';

export interface AiBackendSetting {
  kind: AiBackendKind;
  /** Server root of the remote backend, e.g. `http://gaming-pc:8080`. Required when `kind` is `remote`. */
  url: string | null;
  /** Model name sent to the remote server. `null` uses the backend's own default. */
  model: string | null;
}

export interface AiFallbackSetting {
  /** When the remote has been unreachable for `afterSeconds`, finish the job on the local backend. */
  enabled: boolean;
  afterSeconds: number;
  /** How often to retry the remote while waiting. */
  retrySeconds: number;
}

export interface AiSettings {
  transcription: AiBackendSetting & {
    /** Fixed language code; a wrong auto-detect on short windows costs accuracy. */
    language: string;
  };
  llm: AiBackendSetting;
  fallback: AiFallbackSetting;
}
