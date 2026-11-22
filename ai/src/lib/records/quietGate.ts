import type { RecordsStore } from './recordsStore.js';

export interface QuietGateOptions {
  records: Pick<RecordsStore, 'getAiSettings' | 'anyRecordingLive'>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** How often to look again while waiting. */
  pollMs?: number;
  /** A "go ahead" answer is reused this long, so a call every few seconds does not ask the database every time. */
  goodForMs?: number;
}

/**
 * The gate behind the `ai.pause-while-recording` setting: resolves at once when the setting is off or no
 * table is recording, and otherwise waits, checking again every `pollMs`. It is asked before each Whisper window and
 * each model call, so a job pauses within one call (seconds to minutes) of a recording starting, and picks up where it
 * left off when the last recording stops. A database that cannot be asked never holds work back: a worker that cannot
 * tell is a worker that carries on.
 */
export function createQuietGate(options: QuietGateOptions): () => Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = options.pollMs ?? 15_000;
  const goodForMs = options.goodForMs ?? 5_000;
  let goodUntil = 0;

  const mustWait = async (): Promise<boolean> => {
    try {
      const { processing } = await options.records.getAiSettings();
      return processing.pauseWhileRecording && (await options.records.anyRecordingLive(now()));
    } catch {
      return false;
    }
  };

  return async () => {
    if (now() < goodUntil) return;
    let announced = false;
    while (await mustWait()) {
      if (!announced) {
        options.log?.('a table is recording: processing waits until it stops');
        announced = true;
      }
      await sleep(pollMs);
    }
    if (announced) options.log?.('no table is recording: processing carries on');
    goodUntil = now() + goodForMs;
  };
}
