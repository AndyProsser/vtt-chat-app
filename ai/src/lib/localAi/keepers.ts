import type { GenerateText, TranscribeWav } from '../../types/index.js';
import type { LocalModelStatus } from '../../types/localAi.js';
import { ollamaHasModel, pullOllamaModel } from './ollamaModel.js';

/**
 * Keeping the local AI ready, from inside the worker (ROADMAP Stage 9). The Compose bundle used to run two one-shot
 * containers before anything else could start: one fetched the Whisper model, one ran `ollama pull`. Now the stack
 * starts at once; the Whisper container fetches its own model (infra/compose/whisper-start.sh) and the worker
 * fetches the summary model here, in the background. Only the work that needs a model waits for it:
 * {@link holdForModel} and {@link holdForWhisper} wrap the local backends so a job pauses instead of failing.
 */

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface OllamaModelKeeperOptions {
  baseUrl: string;
  model: string;
  report?: (status: LocalModelStatus) => void;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
  /** Aborts a download in progress (the worker is stopping). */
  signal?: AbortSignal;
  now?: () => number;
  /** While downloading, the status is refreshed at most this often (it is a database write). */
  reportEveryMs?: number;
}

/** Makes sure the summary model is in the local Ollama, downloading it when it is not. */
export class OllamaModelKeeper {
  private ready = false;
  private inflight: Promise<void> | undefined;

  constructor(private readonly options: OllamaModelKeeperOptions) {}

  /**
   * Resolves when the model is there. One check or download runs at a time, shared by every caller; once the
   * model has been seen, later calls cost nothing. Rejects when Ollama does not answer or the download fails.
   */
  ensure(): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.inflight ??= this.fetchModel().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Forget that the model was there (a request just failed; someone may have removed it). */
  invalidate(): void {
    this.ready = false;
  }

  private async fetchModel(): Promise<void> {
    const { baseUrl, model, fetchImpl } = this.options;
    const report = this.options.report ?? (() => undefined);
    const log = this.options.log ?? (() => undefined);
    const now = this.options.now ?? Date.now;

    let present: boolean;
    try {
      present = await ollamaHasModel(baseUrl, model, fetchImpl);
    } catch (error) {
      report({ state: 'waiting', detail: reason(error) });
      throw new Error(`the local LLM (Ollama at ${baseUrl}) is not answering: ${reason(error)}`, {
        cause: error,
      });
    }

    if (!present) {
      log(`the summary model ${model} is not in Ollama yet; downloading it`);
      report({ state: 'downloading', percent: 0 });
      const every = this.options.reportEveryMs ?? 15_000;
      let reportedAt = now();
      let loggedTenth = 0;
      try {
        await pullOllamaModel(baseUrl, model, {
          ...(fetchImpl ? { fetchImpl } : {}),
          ...(this.options.signal ? { signal: this.options.signal } : {}),
          onProgress: (percent) => {
            if (now() - reportedAt >= every) {
              reportedAt = now();
              report({ state: 'downloading', percent });
            }
            const tenth = Math.floor(percent / 10);
            if (tenth > loggedTenth) {
              loggedTenth = tenth;
              log(`the summary model ${model}: ${percent}% downloaded`);
            }
          },
        });
      } catch (error) {
        report({ state: 'failed', detail: reason(error) });
        log(`downloading the summary model ${model} failed: ${reason(error)}`);
        throw error;
      }
      log(`the summary model ${model} is downloaded`);
    }
    this.ready = true;
    report({ state: 'ready' });
  }
}

export interface WhisperReadinessOptions {
  /** The local Whisper server (`WHISPER_LOCAL_URL`); it answers GET /health once its model is loaded. */
  baseUrl: string;
  report?: (status: LocalModelStatus) => void;
  log?: (line: string) => void;
  fetchImpl?: typeof fetch;
}

/** Knows whether the local Whisper server is up. It is not while its container downloads the model (first start). */
export class WhisperReadiness {
  private ready = false;
  private inflight: Promise<void> | undefined;

  constructor(private readonly options: WhisperReadinessOptions) {}

  /** Resolves when Whisper answers; rejects when it does not. Free once it has answered. */
  ensure(): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.inflight ??= this.check().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  invalidate(): void {
    this.ready = false;
  }

  private async check(): Promise<void> {
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/health`;
    const report = this.options.report ?? (() => undefined);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`whisper answered ${response.status}`);
    } catch (error) {
      report({ state: 'waiting', detail: reason(error) });
      throw new Error(
        `the local Whisper (${this.options.baseUrl}) is not ready: ${reason(error)}`,
        {
          cause: error,
        },
      );
    }
    this.ready = true;
    report({ state: 'ready' });
    this.options.log?.('the local Whisper is ready');
  }
}

interface Ensurable {
  ensure(): Promise<void>;
  invalidate(): void;
}

export interface RetryOptions {
  signal?: AbortSignal;
  sleep?: Sleep;
  firstDelayMs?: number;
  maxDelayMs?: number;
  /** Stop trying after this long and resolve anyway (default: never). */
  giveUpAfterMs?: number;
  now?: () => number;
}

/**
 * Calls `ensure()` until it succeeds, pausing 15 s, 30 s, 1 min ... up to 10 min between tries. Used at start-up (in
 * the background, for ever: a later try costs one request) and, with `giveUpAfterMs`, to hold a job. The pauses grow
 * so that an install with no local AI at all (the `records-remote` profile) wakes the worker six times an hour, not more.
 */
export async function keepTrying(target: Ensurable, options: RetryOptions = {}): Promise<boolean> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const started = now();
  let delay = options.firstDelayMs ?? 15_000;
  while (!options.signal?.aborted) {
    try {
      await target.ensure();
      return true;
    } catch {
      if (options.giveUpAfterMs !== undefined && now() - started >= options.giveUpAfterMs) break;
      await sleep(delay, options.signal);
      delay = Math.min(delay * 2, options.maxDelayMs ?? 600_000);
    }
  }
  return false;
}

/** How long a job waits for a local backend that is not ready before it goes ahead and fails (and is retried). */
export const HOLD_JOB_MS = 30 * 60_000;

/**
 * Wraps the local summariser: a call first waits for the model (so a job that arrives while it is downloading
 * pauses rather than burning its five attempts in four minutes), and a failed call makes the next one check again.
 */
export function holdForModel(
  generate: GenerateText,
  keeper: Ensurable,
  options: RetryOptions = {},
): GenerateText {
  return async (prompt) => {
    await keepTrying(keeper, { giveUpAfterMs: HOLD_JOB_MS, maxDelayMs: 60_000, ...options });
    try {
      return await generate(prompt);
    } catch (error) {
      keeper.invalidate();
      throw error;
    }
  };
}

/** The same for the local Whisper server, which is not up while its container fetches the model. */
export function holdForWhisper(
  transcribe: TranscribeWav,
  readiness: Ensurable,
  options: RetryOptions = {},
): TranscribeWav {
  return async (wav) => {
    await keepTrying(readiness, { giveUpAfterMs: HOLD_JOB_MS, maxDelayMs: 60_000, ...options });
    try {
      return await transcribe(wav);
    } catch (error) {
      readiness.invalidate();
      throw error;
    }
  };
}
