import { availableParallelism, loadavg } from 'node:os';

import type { AiSettings } from '@vtt-chat-app/shared';

import type { RecordsStore } from './recordsStore.js';

export interface ActivityGovernorOptions {
  records: Pick<RecordsStore, 'onlineUserCount'>;
  settings: () => Promise<Pick<AiSettings, 'processing'>>;
  now?: () => number;
  loadavg?: () => number[];
  cpuCount?: () => number;
  /** A recent answer is reused this long, so a call before every track dispatch does not read
   *  presence and settings every time. Same shape as `quietGate`'s own `goodForMs`. */
  goodForMs?: number;
}

export interface ActivityGovernor {
  /** `tracksRemaining` is how many of the recording's tracks still need transcribing this run. */
  trackConcurrency(tracksRemaining: number): Promise<number>;
}

/**
 * How many tracks a recording may transcribe at once, right now: presence drives it (nobody
 * online -> use the box, bounded by core count; someone online -> a conservative default), CPU
 * load is only a backup clamp once someone is online, never the thing that decides "nobody's
 * here." An unreadable presence signal is treated as "someone's online" (the conservative tier) —
 * the opposite of `quietGate`'s own fail-open convention for its own, different signal, because
 * here the wrong default would be the one that contends with a real player.
 */
export function createActivityGovernor(options: ActivityGovernorOptions): ActivityGovernor {
  const now = options.now ?? Date.now;
  const readLoadavg = options.loadavg ?? loadavg;
  const cpuCount = options.cpuCount ?? availableParallelism;
  const goodForMs = options.goodForMs ?? 5000;

  let cached: { at: number; onlineUsers: number; processing: AiSettings['processing'] } | undefined;

  const read = async (): Promise<{ onlineUsers: number; processing: AiSettings['processing'] }> => {
    if (cached && now() < cached.at + goodForMs) return cached;
    const [onlineUsers, settings] = await Promise.all([
      options.records.onlineUserCount().catch(() => 1),
      options.settings(),
    ]);
    cached = { at: now(), onlineUsers, processing: settings.processing };
    return cached;
  };

  return {
    async trackConcurrency(tracksRemaining: number): Promise<number> {
      const { onlineUsers, processing } = await read();
      if (onlineUsers === 0) return Math.min(cpuCount(), tracksRemaining);
      const load = readLoadavg()[0] ?? 0;
      const busy = load / cpuCount() >= processing.cpuThresholdPercent / 100;
      return Math.min(busy ? 1 : processing.activeConcurrency, tracksRemaining);
    },
  };
}
