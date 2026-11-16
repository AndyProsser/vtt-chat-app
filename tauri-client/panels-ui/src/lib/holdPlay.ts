/** How long a press must last before it counts as a hold rather than a click. */
export const HOLD_MS = 350;
/** A held stinger is cut off after this long even if the release is never seen (focus lost, window closed). */
export const HOLD_MAX_MS = 60_000;

export interface HoldPlay {
  down(): void;
  /** Pointer released, cancelled or left. Returns true when it ended a hold. */
  up(): boolean;
  /** True once, right after a hold ended, so the click that follows the release is not also played. */
  takeClickSuppression(): boolean;
}

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (h) => window.clearTimeout(h as number),
};

/**
 * Click-and-hold for a stinger: a quick click plays it once as usual; holding past `HOLD_MS` starts it looping
 * (`onStart(playId)`) and letting go stops that loop (`onEnd(playId)`). The caller picks nothing but the sound:
 * the play id is made here so the release can stop exactly this play and leave a running scene alone.
 */
export function createHoldPlay(
  onStart: (playId: string) => void,
  onEnd: (playId: string) => void,
  newId: () => string = () => crypto.randomUUID(),
  timers: Timers = realTimers,
): HoldPlay {
  let pending: unknown;
  let cutoff: unknown;
  let playId: string | undefined;
  let suppress = false;

  const end = (): boolean => {
    if (pending !== undefined) timers.clear(pending);
    if (cutoff !== undefined) timers.clear(cutoff);
    pending = cutoff = undefined;
    if (playId === undefined) return false;
    const id = playId;
    playId = undefined;
    suppress = true;
    onEnd(id);
    return true;
  };

  return {
    down() {
      end();
      suppress = false;
      pending = timers.set(() => {
        pending = undefined;
        playId = newId();
        onStart(playId);
        cutoff = timers.set(end, HOLD_MAX_MS);
      }, HOLD_MS);
    },
    up: end,
    takeClickSuppression() {
      const was = suppress;
      suppress = false;
      return was;
    },
  };
}
