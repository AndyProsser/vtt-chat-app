// The monitor: samples a target while a run is in progress and writes what it sees.
//
//   samples.jsonl  one line per sample: host CPU, memory, load, network, disk, every container, latency, new error lines
//   events.jsonl   phase changes, the runner's actions, every error line found
//
// Each sample carries the phase the runner was in, so numbers are compared like with like (report.ts). It reads
// everything in one script per sample (one SSH round trip on a remote target) and never changes the target.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  cpuPercent,
  parseDf,
  parseDockerStats,
  parseInspect,
  parseLoadAvg,
  parseLogLines,
  parseMeminfo,
  parseNetDev,
  parseProcStat,
  splitSections,
  type ContainerState,
  type ContainerStat,
  type CpuTimes,
  type DiskUse,
} from './parse.ts';
import { shq, type Target } from './target.ts';

export const DEFAULT_ERROR_PATTERN =
  '\\b(error|warn|warning|panic|fatal|oom|unhandled|exception|econnrefused|enotfound|timed? ?out|failed)\\b';
/** Lines that look like errors and are not: health probes, info-level logs that mention a word, "0 errors". */
export const DEFAULT_IGNORE_PATTERN =
  'level=info|"level":"info"|\\sINFO\\s|\\sDEBUG\\s|Discard success message|Failed to ping without candidate pairs|could not match local candidate|error reading data channel.*User Initiated Abort|healthcheck|/api/health|0 errors|no errors|error_log off';

export interface Sample {
  t: string;
  tMs: number;
  phase: string;
  /** Seconds since the previous sample on the target (the real interval, not the nominal one). */
  dt?: number;
  host?: {
    cpuPct?: number;
    load1?: number;
    load5?: number;
    memUsedBytes?: number;
    memTotalBytes?: number;
    swapUsedBytes?: number;
    netRxBps?: number;
    netTxBps?: number;
    netRxBytes?: number;
    netTxBytes?: number;
  };
  disks?: DiskUse[];
  containers?: (ContainerStat & Partial<ContainerState>)[];
  latency?: { healthMs?: number; healthStatus?: number; statusMs?: number; error?: string };
  newErrors?: number;
  /** The sampling itself failed (an SSH hiccup): the gap is recorded, the run goes on. */
  failure?: string;
}

export interface RunEvent {
  t: string;
  phase: string;
  kind: string;
  [key: string]: unknown;
}

const scriptFor = (lastSec: number | undefined, pattern: string, ignore: string): string => `
set +e
LAST_SEC=${lastSec ?? ''}
echo "@@TS"; date +%s%3N
echo "@@STAT"; head -1 /proc/stat
echo "@@LOAD"; cat /proc/loadavg
echo "@@MEM"; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo
echo "@@NET"; cat /proc/net/dev
echo "@@DISK"; df -B1 --output=target,size,avail / /var/lib/docker 2>/dev/null
echo "@@DOCKER"; docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}' 2>/dev/null
echo "@@INSPECT"; ids=$(docker ps -q 2>/dev/null); [ -n "$ids" ] && docker inspect --format '{{.Name}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' $ids 2>/dev/null
echo "@@LOGS"
if [ -n "$LAST_SEC" ]; then
  since=$(date -u -d "@$LAST_SEC" +%Y-%m-%dT%H:%M:%SZ)
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
    docker logs --since "$since" "$c" 2>&1 | grep -aiE ${shq(pattern)} | grep -avE ${shq(ignore)} | tail -20 | sed "s/^/$c|/"
  done
fi
`;

export interface MonitorOptions {
  target: Target;
  outDir: string;
  intervalMs?: number;
  errorPattern?: string;
  ignorePattern?: string;
  log?: (line: string) => void;
}

export class Monitor {
  readonly samples: Sample[] = [];
  readonly events: RunEvent[] = [];
  phase = 'init';
  private readonly o: Required<Omit<MonitorOptions, 'log'>> & { log: (l: string) => void };
  private timer?: NodeJS.Timeout;
  private running = false;
  private inFlight?: Promise<void>;
  private prevCpu?: CpuTimes;
  private prevNet?: { rx: number; tx: number; ms: number };
  private lastRemoteSec?: number;
  private readonly seenErrors = new Set<string>();
  private failures = 0;
  /** What the target is, read once at the start (the report's header). */
  info: Record<string, string> = {};

  constructor(o: MonitorOptions) {
    this.o = {
      intervalMs: 5000,
      errorPattern: DEFAULT_ERROR_PATTERN,
      ignorePattern: DEFAULT_IGNORE_PATTERN,
      log: () => {},
      ...o,
    };
  }

  private get samplesFile() {
    return path.join(this.o.outDir, 'samples.jsonl');
  }
  private get eventsFile() {
    return path.join(this.o.outDir, 'events.jsonl');
  }

  async readInfo(): Promise<void> {
    const out = await this.o.target
      .run(
        `echo "cpu|$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//')"
echo "cores|$(nproc)"
echo "memory|$(grep MemTotal /proc/meminfo | awk '{print $2*1024}')"
echo "kernel|$(uname -r)"
echo "docker|$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
echo "version|$(cat ${shq(this.o.target.composeDir)}/.installed-version 2>/dev/null || docker ps --format '{{.Image}}' 2>/dev/null | grep -m1 backend | sed 's/.*://')"
echo "gpu|$(nvidia-smi -L 2>/dev/null | head -1 | sed 's/ (UUID.*//')"`,
      )
      .catch(() => '');
    for (const line of out.split('\n')) {
      const i = line.indexOf('|');
      if (i > 0 && line.slice(i + 1).trim() !== '')
        this.info[line.slice(0, i)] = line.slice(i + 1).trim();
    }
  }

  async start(): Promise<void> {
    await mkdir(this.o.outDir, { recursive: true });
    await this.readInfo();
    this.running = true;
    await this.sampleOnce(); // the first reading primes the CPU and network deltas
    // A steady beat: the next sample is due one interval after the last one STARTED, not after it finished
    // (a reading takes a second or two on a busy host), or the real interval would drift well past the asked one.
    const tick = () => {
      if (!this.running) return;
      const began = Date.now();
      this.inFlight = this.sampleOnce().finally(() => {
        if (this.running)
          this.timer = setTimeout(tick, Math.max(0, this.o.intervalMs - (Date.now() - began)));
      });
    };
    this.timer = setTimeout(tick, this.o.intervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
    await this.sampleOnce(); // a last reading so the final phase has an end
  }

  /** Marks the start of a phase: every sample from here on carries it. */
  async setPhase(name: string, note?: string): Promise<void> {
    this.phase = name;
    await this.event('phase', { name, ...(note ? { note } : {}) });
  }

  async event(kind: string, data: Record<string, unknown> = {}): Promise<void> {
    const e: RunEvent = { t: new Date().toISOString(), phase: this.phase, kind, ...data };
    this.events.push(e);
    await appendFile(this.eventsFile, JSON.stringify(e) + '\n');
  }

  private async probe(): Promise<NonNullable<Sample['latency']>> {
    const base = this.o.target.apiBase;
    const one = async (route: string): Promise<{ ms: number; status: number }> => {
      const t0 = performance.now();
      const res = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(8000) });
      await res.arrayBuffer();
      return { ms: performance.now() - t0, status: res.status };
    };
    try {
      const h = await one('/api/health');
      const s = await one('/api/status').catch(() => undefined);
      return { healthMs: h.ms, healthStatus: h.status, ...(s ? { statusMs: s.ms } : {}) };
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      const why = cause?.code ?? cause?.message;
      return { error: why ? `${(e as Error).message}: ${why}` : (e as Error).message };
    }
  }

  async sampleOnce(): Promise<void> {
    const phase = this.phase;
    const now = Date.now();
    const sample: Sample = { t: new Date(now).toISOString(), tMs: now, phase };
    try {
      const [raw, latency] = await Promise.all([
        this.o.target.run(
          scriptFor(this.lastRemoteSec, this.o.errorPattern, this.o.ignorePattern),
          45_000,
        ),
        this.probe(),
      ]);
      sample.latency = latency;
      const sec = splitSections(raw);
      const remoteMs = Number((sec.TS ?? '').trim());
      if (Number.isFinite(remoteMs) && remoteMs > 0) {
        if (this.lastRemoteSec !== undefined)
          sample.dt = (remoteMs - this.lastRemoteSec * 1000) / 1000;
        this.lastRemoteSec = Math.floor(remoteMs / 1000);
      }
      const host: NonNullable<Sample['host']> = {};
      const cpu = parseProcStat(sec.STAT ?? '');
      if (cpu) {
        if (this.prevCpu) {
          const pct = cpuPercent(this.prevCpu, cpu);
          if (pct !== undefined) host.cpuPct = pct;
        }
        this.prevCpu = cpu;
      }
      const load = parseLoadAvg(sec.LOAD ?? '');
      if (load) Object.assign(host, { load1: load.load1, load5: load.load5 });
      const mem = parseMeminfo(sec.MEM ?? '');
      if (mem)
        Object.assign(host, {
          memUsedBytes: mem.usedBytes,
          memTotalBytes: mem.totalBytes,
          swapUsedBytes: mem.swapUsedBytes,
        });
      const net = parseNetDev(sec.NET ?? '');
      host.netRxBytes = net.rxBytes;
      host.netTxBytes = net.txBytes;
      const atMs = Number.isFinite(remoteMs) ? remoteMs : now;
      if (this.prevNet && atMs > this.prevNet.ms) {
        const s = (atMs - this.prevNet.ms) / 1000;
        host.netRxBps = Math.max(0, (net.rxBytes - this.prevNet.rx) / s);
        host.netTxBps = Math.max(0, (net.txBytes - this.prevNet.tx) / s);
      }
      this.prevNet = { rx: net.rxBytes, tx: net.txBytes, ms: atMs };
      sample.host = host;
      sample.disks = parseDf(sec.DISK ?? '');
      const states = new Map(parseInspect(sec.INSPECT ?? '').map((s) => [s.name, s]));
      sample.containers = parseDockerStats(sec.DOCKER ?? '').map((c) => ({
        ...c,
        ...(states.get(c.name) ?? {}),
      }));
      let fresh = 0;
      for (const l of parseLogLines(sec.LOGS ?? '')) {
        const key = `${l.container}|${l.line}`;
        if (this.seenErrors.has(key)) continue;
        this.seenErrors.add(key);
        fresh += 1;
        await this.event('log-error', { container: l.container, line: l.line.slice(0, 400) });
      }
      sample.newErrors = fresh;
      this.failures = 0;
    } catch (e) {
      sample.failure = (e as Error).message;
      this.failures += 1;
      if (this.failures === 3) this.o.log(`monitor: 3 samples in a row failed (${sample.failure})`);
    }
    this.samples.push(sample);
    await appendFile(this.samplesFile, JSON.stringify(sample) + '\n');
  }
}
