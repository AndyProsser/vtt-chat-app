import os from 'node:os';
import { readFile } from 'node:fs/promises';

import { measureDisk, type DiskUse } from './storage.js';

/**
 * The machine `vtt-admin status` runs on: CPU, memory, load and the disks the data lives on.
 *
 * Under Docker Compose the CLI runs inside the backend container. CPU, load and memory there are the
 * host's (Linux does not namespace them), unless the container has a memory limit, which is then shown
 * as the total instead. The disks are the volumes the container's data folders sit on.
 */
export interface MachineInfo {
  hostname: string;
  /** e.g. "Linux 6.8.0-49-generic". */
  os: string;
  uptimeSeconds: number;
  cpu: {
    cores: number;
    model: string;
    /** Busy share of all cores over a short sample, 0..1. */
    busy: number;
    /** 1, 5 and 15 minute load averages. */
    load: [number, number, number];
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    /** True when the total is a container limit rather than the machine's memory. */
    limited: boolean;
  };
  /** One entry per distinct volume, labelled by what lives on it. */
  disks: { label: string; path: string; use: DiskUse }[];
}

const idleAndTotal = (): { idle: number; total: number } =>
  os.cpus().reduce(
    (acc, cpu) => {
      const t = cpu.times;
      return {
        idle: acc.idle + t.idle,
        total: acc.total + t.user + t.nice + t.sys + t.idle + t.irq,
      };
    },
    { idle: 0, total: 0 },
  );

/** Busy share of the CPUs over `ms`. */
async function sampleCpu(ms: number): Promise<number> {
  const a = idleAndTotal();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const b = idleAndTotal();
  const total = b.total - a.total;
  return total > 0 ? 1 - (b.idle - a.idle) / total : 0;
}

/** A cgroup v2 memory limit and usage, when this process has one ("max" means none). */
async function cgroupMemory(): Promise<{ limit: number; used: number } | null> {
  try {
    const max = (await readFile('/sys/fs/cgroup/memory.max', 'utf8')).trim();
    if (max === 'max') return null;
    const used = Number((await readFile('/sys/fs/cgroup/memory.current', 'utf8')).trim());
    const limit = Number(max);
    return Number.isFinite(limit) && limit > 0 && limit < os.totalmem() ? { limit, used } : null;
  } catch {
    return null;
  }
}

/** Reads the machine. `places` are labelled folders whose volumes are shown (one row per volume). */
export async function readMachine(places: { label: string; path: string }[]): Promise<MachineInfo> {
  const [busy, limited] = await Promise.all([sampleCpu(250), cgroupMemory()]);
  const disks: MachineInfo['disks'] = [];
  for (const place of places) {
    const use = await measureDisk(place.path);
    if (!use) continue;
    // Folders on the same volume share one row: "data, recordings".
    const same = disks.find(
      (d) => d.use.totalBytes === use.totalBytes && d.use.freeBytes === use.freeBytes,
    );
    if (same) same.label = `${same.label}, ${place.label}`;
    else disks.push({ label: place.label, path: place.path, use });
  }
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    uptimeSeconds: os.uptime(),
    cpu: {
      cores: cpus.length,
      model: (cpus[0]?.model ?? 'unknown').replace(/\s+/g, ' ').trim(),
      busy,
      load: os.loadavg() as [number, number, number],
    },
    memory: limited
      ? { totalBytes: limited.limit, usedBytes: limited.used, limited: true }
      : { totalBytes: os.totalmem(), usedBytes: os.totalmem() - os.freemem(), limited: false },
    disks,
  };
}
