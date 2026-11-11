import type { JobQueue } from '@vtt-chat-app/ai';

import type { ClientDownloads } from '../config.js';
import { freePercent, isLow, type DiskUse } from './storage.js';

/** One health check. `run` resolves when the service is fine and throws when it is not. */
export interface StatusProbe {
  name: string;
  run(): Promise<void>;
}

export interface ServiceStatus {
  name: string;
  ok: boolean;
}

export interface StatusSnapshot {
  at: number;
  /** Everything checked below is fine. */
  ok: boolean;
  services: ServiceStatus[];
  players: { online: number };
  recording: { active: number };
  /** The records pipeline: how much is waiting, and how the last job ended. */
  pipeline: {
    queued: number;
    running: number;
    failed: number;
    last: { state: 'done' | 'failed'; at: number } | null;
  } | null;
  /** The recordings disk: only the free share, never paths or sizes. Null when not measured. */
  storage: { freePercent: number; low: boolean } | null;
  downloads: ClientDownloads;
}

export interface StatusDeps {
  probes: StatusProbe[];
  onlinePlayers: () => number;
  activeRecordings: () => number;
  jobs?: JobQueue;
  /** Measures the disk that holds recordings; null when there is none to measure. */
  storage?: () => Promise<DiskUse | null>;
  downloads: () => Promise<ClientDownloads>;
  now?: () => number;
  /** How long a snapshot is reused, so a busy status page cannot hammer the services. */
  cacheMs?: number;
}

const PROBE_TIMEOUT_MS = 4000;

/**
 * The public status page's data. Deliberately coarse: service names with up/down, counts, and the
 * download links. No error text, addresses, names or campaign details, because anyone can read it.
 */
export class StatusService {
  private cached: StatusSnapshot | undefined;
  private inflight: Promise<StatusSnapshot> | undefined;

  constructor(private readonly deps: StatusDeps) {}

  async snapshot(): Promise<StatusSnapshot> {
    const now = (this.deps.now ?? Date.now)();
    const cacheMs = this.deps.cacheMs ?? 10_000;
    if (this.cached && now - this.cached.at < cacheMs) return this.cached;
    this.inflight ??= this.build(now).finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async build(at: number): Promise<StatusSnapshot> {
    const services: ServiceStatus[] = [{ name: 'backend', ok: true }];
    services.push(
      ...(await Promise.all(
        this.deps.probes.map(async (p) => ({ name: p.name, ok: await passes(p) })),
      )),
    );
    let pipeline: StatusSnapshot['pipeline'] = null;
    if (this.deps.jobs) {
      try {
        pipeline = summarise(await this.deps.jobs.list());
      } catch {
        services.push({ name: 'records pipeline', ok: false });
      }
    }
    let storage: StatusSnapshot['storage'] = null;
    if (this.deps.storage) {
      const use = await this.deps.storage().catch(() => null);
      if (use) {
        storage = { freePercent: freePercent(use), low: isLow(use) };
        services.push({ name: 'storage', ok: !storage.low });
      }
    }
    const snapshot: StatusSnapshot = {
      at,
      ok: services.every((s) => s.ok),
      services,
      players: { online: this.deps.onlinePlayers() },
      recording: { active: this.deps.activeRecordings() },
      pipeline,
      storage,
      downloads: await this.deps.downloads(),
    };
    this.cached = snapshot;
    return snapshot;
  }
}

async function passes(probe: StatusProbe): Promise<boolean> {
  try {
    await Promise.race([
      probe.run(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out')), PROBE_TIMEOUT_MS).unref(),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

function summarise(
  jobs: Awaited<ReturnType<JobQueue['list']>>,
): NonNullable<StatusSnapshot['pipeline']> {
  const count = (state: string) => jobs.filter((j) => j.state === state).length;
  const finished = jobs
    .filter((j) => j.state === 'done' || j.state === 'failed')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return {
    queued: count('queued'),
    running: count('running'),
    failed: count('failed'),
    last: finished ? { state: finished.state as 'done' | 'failed', at: finished.updatedAt } : null,
  };
}
