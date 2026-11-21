// Parsers for what the monitor reads from a target (a Linux host running the Docker Compose stack). Pure
// functions over text, so they are tested with captured output and nothing else (parse.test.ts).

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** "1.5GiB", "12kB", "0B" (docker prints decimal units for network and block I/O, binary for memory). */
export function parseBytes(text: string): number {
  const m = /^\s*([\d.]+)\s*([a-zA-Z]*)\s*$/.exec(text);
  if (!m) return NaN;
  const unit = UNITS[(m[2] ?? '').toLowerCase() || 'b'];
  return unit === undefined ? NaN : Number(m[1]) * unit;
}

const pair = (text: string): [number, number] => {
  const [a, b] = text.split('/');
  return [parseBytes(a ?? ''), parseBytes(b ?? '')];
};

export interface CpuTimes {
  busy: number;
  total: number;
}

/** The aggregate `cpu` line of /proc/stat: busy and total jiffies (idle and iowait count as not busy). */
export function parseProcStat(text: string): CpuTimes | undefined {
  const line = text.split('\n').find((l) => /^cpu\s/.test(l));
  if (!line) return undefined;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  if (n.length < 5 || n.some(Number.isNaN)) return undefined;
  const total = n.slice(0, 8).reduce((a, b) => a + b, 0);
  const idle = (n[3] ?? 0) + (n[4] ?? 0);
  return { busy: total - idle, total };
}

/** Percent busy between two readings; undefined when no time passed. */
export function cpuPercent(prev: CpuTimes, now: CpuTimes): number | undefined {
  const dt = now.total - prev.total;
  return dt > 0 ? Math.max(0, Math.min(100, ((now.busy - prev.busy) / dt) * 100)) : undefined;
}

export function parseLoadAvg(
  text: string,
): { load1: number; load5: number; load15: number } | undefined {
  const [a, b, c] = text.trim().split(/\s+/).map(Number);
  return a === undefined || b === undefined || c === undefined || [a, b, c].some(Number.isNaN)
    ? undefined
    : { load1: a, load5: b, load15: c };
}

export interface Mem {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export function parseMeminfo(text: string): Mem | undefined {
  const kb = (key: string): number | undefined => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
    return m ? Number(m[1]) * 1024 : undefined;
  };
  const total = kb('MemTotal');
  const avail = kb('MemAvailable');
  if (total === undefined || avail === undefined) return undefined;
  const swapTotal = kb('SwapTotal') ?? 0;
  return {
    totalBytes: total,
    availableBytes: avail,
    usedBytes: total - avail,
    swapTotalBytes: swapTotal,
    swapUsedBytes: swapTotal - (kb('SwapFree') ?? swapTotal),
  };
}

/** Bytes in and out over the real interfaces (not loopback, bridges or per-container veth pairs). */
export function parseNetDev(text: string): { rxBytes: number; txBytes: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const iface = m[1] as string;
    if (iface === 'lo' || /^(docker|br-|veth|virbr|cni|flannel)/.test(iface)) continue;
    const f = (m[2] as string).trim().split(/\s+/).map(Number);
    rx += f[0] ?? 0;
    tx += f[8] ?? 0;
  }
  return { rxBytes: rx, txBytes: tx };
}

export interface DiskUse {
  mount: string;
  sizeBytes: number;
  availBytes: number;
}

/** `df -B1 --output=target,size,avail` rows (the header is skipped). */
export function parseDf(text: string): DiskUse[] {
  const out: DiskUse[] = [];
  for (const line of text.split('\n')) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s*$/.exec(line.trim());
    if (m) out.push({ mount: m[1] as string, sizeBytes: Number(m[2]), availBytes: Number(m[3]) });
  }
  return out;
}

export interface ContainerStat {
  name: string;
  cpuPct: number;
  memBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}

/** Lines of `docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}'`. */
export function parseDockerStats(text: string): ContainerStat[] {
  const out: ContainerStat[] = [];
  for (const line of text.split('\n')) {
    const f = line.trim().split('|');
    if (f.length < 6) continue;
    const [mem, memLimit] = pair(f[2] as string);
    const [rx, tx] = pair(f[3] as string);
    const [br, bw] = pair(f[4] as string);
    const cpu = Number(String(f[1]).replace('%', ''));
    if (Number.isNaN(cpu)) continue;
    out.push({
      name: f[0] as string,
      cpuPct: cpu,
      memBytes: mem,
      memLimitBytes: memLimit,
      netRxBytes: rx,
      netTxBytes: tx,
      blockReadBytes: br,
      blockWriteBytes: bw,
      pids: Number(f[5]) || 0,
    });
  }
  return out;
}

export interface ContainerState {
  name: string;
  oomKilled: boolean;
  restarts: number;
  health: string;
}

/** Lines of `docker inspect --format '{{.Name}}|{{.State.OOMKilled}}|{{.RestartCount}}|health'`. */
export function parseInspect(text: string): ContainerState[] {
  const out: ContainerState[] = [];
  for (const line of text.split('\n')) {
    const f = line.trim().split('|');
    if (f.length < 4) continue;
    out.push({
      name: (f[0] as string).replace(/^\//, ''),
      oomKilled: f[1] === 'true',
      restarts: Number(f[2]) || 0,
      health: f[3] as string,
    });
  }
  return out;
}

export interface LogLine {
  container: string;
  line: string;
}

/** `container|<line>` rows from the sampler's log scan. */
export function parseLogLines(text: string): LogLine[] {
  const out: LogLine[] = [];
  for (const raw of text.split('\n')) {
    const i = raw.indexOf('|');
    if (i <= 0) continue;
    out.push({ container: raw.slice(0, i), line: raw.slice(i + 1).trim() });
  }
  return out;
}

/** Splits the sampler's output into its `@@NAME` sections. */
export function splitSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name: string | undefined;
  const buf: string[] = [];
  const flush = () => {
    if (name !== undefined) out[name] = buf.join('\n');
    buf.length = 0;
  };
  for (const line of text.split('\n')) {
    const m = /^@@([A-Z]+)\s*$/.exec(line);
    if (m) {
      flush();
      name = m[1];
    } else buf.push(line);
  }
  flush();
  return out;
}
