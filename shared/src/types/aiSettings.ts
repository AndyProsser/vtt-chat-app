/**
 * Where transcription and summarisation run. Decided 2026-11-07 (CLAUDE.md §5): the local backend
 * is always configured and is the fallback; a remote backend (e.g. a GPU in the operator's own PC,
 * or a cloud API) is optional, reached over the OpenAI-compatible API.
 *
 * API keys are **not** stored here — they come from the environment (`WHISPER_API_KEY`,
 * `LLM_API_KEY`, `ANTHROPIC_API_KEY`), so a database dump never contains a credential.
 */
export type AiBackendKind = 'local' | 'remote';

/** The LLM may also be Claude or OpenAI (Stage 12 CL): opt-in off-site adapters, never the default. */
export type AiLlmKind = AiBackendKind | 'claude' | 'openai';

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

export interface AiTaleSettings {
  /** How long and full tales may be: the operator's ceiling (a slow CPU-only server: short). */
  length: 'short' | 'default' | 'long';
  /** How strong the language and violence in a tale may be. */
  content: 'clean' | 'default' | 'graphic';
  /** Storytellers this server does not offer. Never contains the Tavern Bard. */
  storytellersOff: import('../consts/bards.js').BardId[];
}

export interface AiSettings {
  transcription: AiBackendSetting & {
    /** Fixed language code; a wrong auto-detect on short windows costs accuracy. */
    language: string;
    /**
     * What the campaign's names are used for (Stage 12): `corrections` fixes misheard names afterwards, `prompt` also
     * tells Whisper the names up front, `both` does both, `off` neither. Default `corrections`: an earlier name
     * prompt lowered accuracy, so the prompt stays opt-in until it is measured to help.
     */
    glossary: 'off' | 'corrections' | 'prompt' | 'both';
  };
  /**
   * For `claude`, `model` is a Claude model id (default `claude-sonnet-5-5`); for `openai` it is required (the operator
   * names it; no default goes stale). `url` is unused for both. `priceIn` and `priceOut` are US dollars per million
   * tokens, for the cost shown in `jobs list` (a Claude model in the built-in table needs neither; OpenAI needs them
   * for a cost, otherwise only tokens are shown).
   */
  llm: Omit<AiBackendSetting, 'kind'> & {
    kind: AiLlmKind;
    priceIn: number | null;
    priceOut: number | null;
    /**
     * Tokens the local or remote server actually exposes (e.g. Ollama's `OLLAMA_CONTEXT_LENGTH`), since the
     * OpenAI-compatible API cannot ask it directly; `null` uses the measured 8,192 default. Ignored for
     * `claude` and `openai`, which use their own, much larger built-in default instead.
     */
    context: number | null;
  };
  fallback: AiFallbackSetting;
  tale: AiTaleSettings;
  /**
   * Campaign memory (Stage 12 F): after each session one more model call keeps a list of the people, places, groups,
   * quests and items the party has met, for the tale and the Game Master's brief to refer back to. On by default; a
   * slow CPU-only server may turn it off to save that call.
   */
  memory: { enabled: boolean };
  /**
   * Local AI work (transcribing, the model's calls) waits while any table is recording, so a recording's own services
   * (LiveKit, Egress) never compete with it for the CPU. Off by default: it delays the tales, and a server with a
   * strong GPU or a cloud backend does not need it. The call in progress finishes first (minutes, not the whole job).
   */
  processing: {
    pauseWhileRecording: boolean;
    /** How many tracks transcribe at once while someone is online (CPU load clamps it to 1). */
    activeConcurrency: number;
    /** % of cores busy (1-minute load average) above which active-tier concurrency clamps to 1. */
    cpuThresholdPercent: number;
  };
}
