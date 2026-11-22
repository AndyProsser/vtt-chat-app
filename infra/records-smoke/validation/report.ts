// From samples and events to the run's numbers (summary.json) and the page a person reads (report.md).
// Everything is judged per phase. Thresholds come later (after the first runs), so this reports and flags; it does not fail a run.

import { summarise, fmtBytes, fmtDuration, fmtNum, fmtRate, type Summary } from './stats.ts';
import type { RunEvent, Sample } from './monitor.ts';
import type { SessionPlan } from './plan.ts';

export interface Check {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

export interface RunMeta {
  mode: 'dry' | 'live';
  target: string;
  label: string;
  startedAt: string;
  endedAt: string;
  info: Record<string, string>;
  intervalMs: number;
  speed?: number;
  plan: SessionPlan[];
  checks: Check[];
  /** Numbers a live run produced (recall, accuracy, timings). No thresholds yet: they are reported, not judged. */
  scores?: { name: string; value: string; detail?: string }[];
  notes: string[];
  /** What this run did not measure, said plainly in the report. */
  notMeasured: string[];
}

export interface PhaseSummary {
  name: string;
  durationSec: number;
  samples: number;
  cpuPct?: Summary;
  load1?: Summary;
  memUsedBytes?: Summary;
  swapUsedBytes?: Summary;
  netRxBps?: Summary;
  netTxBps?: Summary;
  healthMs?: Summary;
  statusMs?: Summary;
  netRxBytes?: number;
  netTxBytes?: number;
  rootFreeBytesChange?: number;
  errorLines: number;
  failedProbes: number;
}

export interface ContainerSummary {
  name: string;
  cpuPct?: Summary;
  memBytes?: Summary;
  memLimitBytes?: number;
  netRxBytes?: number;
  netTxBytes?: number;
  blockReadBytes?: number;
  blockWriteBytes?: number;
  restarts: number;
  oomKilled: boolean;
  unhealthySamples: number;
  cpuMeanByPhase: Record<string, number>;
  memMaxByPhase: Record<string, number>;
}

export interface ErrorGroup {
  container: string;
  count: number;
  examples: string[];
}

export interface RunSummary {
  meta: RunMeta;
  sampling: { samples: number; failed: number; medianIntervalSec?: number };
  phases: PhaseSummary[];
  containers: ContainerSummary[];
  errors: ErrorGroup[];
  findings: string[];
  /** The first probe failure's reason, so a certificate or DNS problem is named, not just counted. */
  probeError?: string;
}

/** Restarts during the run: the highest counter seen minus the lowest (the counter only goes up, and a container that restarts shows it in later samples). */
const restartsDuringRun = (v: (number | undefined)[]): number => {
  const n = v.filter((x): x is number => typeof x === 'number');
  return n.length ? Math.max(...n) - Math.min(...n) : 0;
};

const median = (v: number[]): number | undefined => {
  if (v.length === 0) return undefined;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const delta = (values: (number | undefined)[]): number | undefined => {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length >= 2 ? (v[v.length - 1] as number) - (v[0] as number) : undefined;
};

function phaseOrder(
  events: RunEvent[],
  samples: Sample[],
): { name: string; startMs: number; endMs: number }[] {
  const starts = events
    .filter((e) => e.kind === 'phase')
    .map((e) => ({ name: String(e.name), ms: Date.parse(e.t) }));
  const runEnd = samples.length ? (samples[samples.length - 1] as Sample).tMs : Date.now();
  return starts.map((s, i) => ({
    name: s.name,
    startMs: s.ms,
    endMs: starts[i + 1]?.ms ?? runEnd,
  }));
}

export function summarise_run(samples: Sample[], events: RunEvent[], meta: RunMeta): RunSummary {
  const ok = samples.filter((s) => !s.failure);
  const phases = phaseOrder(events, samples);
  const rootOf = (s: Sample) => s.disks?.find((d) => d.mount === '/')?.availBytes;

  const phaseSummaries: PhaseSummary[] = phases.map((p) => {
    const inP = ok.filter((s) => s.phase === p.name);
    const host = (f: (s: Sample) => number | undefined) => summarise(inP.map(f));
    return {
      name: p.name,
      durationSec: (p.endMs - p.startMs) / 1000,
      samples: inP.length,
      cpuPct: host((s) => s.host?.cpuPct),
      load1: host((s) => s.host?.load1),
      memUsedBytes: host((s) => s.host?.memUsedBytes),
      swapUsedBytes: host((s) => s.host?.swapUsedBytes),
      netRxBps: host((s) => s.host?.netRxBps),
      netTxBps: host((s) => s.host?.netTxBps),
      healthMs: host((s) => s.latency?.healthMs),
      statusMs: host((s) => s.latency?.statusMs),
      netRxBytes: delta(inP.map((s) => s.host?.netRxBytes)),
      netTxBytes: delta(inP.map((s) => s.host?.netTxBytes)),
      rootFreeBytesChange: delta(inP.map(rootOf)),
      errorLines: events.filter((e) => e.kind === 'log-error' && e.phase === p.name).length,
      failedProbes: inP.filter((s) => s.latency?.error || (s.latency?.healthStatus ?? 200) >= 400)
        .length,
    };
  });

  const names = [...new Set(ok.flatMap((s) => (s.containers ?? []).map((c) => c.name)))].sort();
  const containers: ContainerSummary[] = names.map((name) => {
    const rows = ok
      .map((s) => ({ s, c: s.containers?.find((c) => c.name === name) }))
      .filter((r) => r.c);
    const cs = rows.map((r) => r.c!);
    const byPhase = (f: (c: (typeof cs)[number]) => number, agg: 'mean' | 'max') => {
      const out: Record<string, number> = {};
      for (const p of phases) {
        const v = rows.filter((r) => r.s.phase === p.name).map((r) => f(r.c!));
        if (v.length)
          out[p.name] = agg === 'mean' ? v.reduce((a, b) => a + b, 0) / v.length : Math.max(...v);
      }
      return out;
    };
    return {
      name,
      cpuPct: summarise(cs.map((c) => c.cpuPct)),
      memBytes: summarise(cs.map((c) => c.memBytes)),
      memLimitBytes: cs[cs.length - 1]?.memLimitBytes,
      netRxBytes: delta(cs.map((c) => c.netRxBytes)),
      netTxBytes: delta(cs.map((c) => c.netTxBytes)),
      blockReadBytes: delta(cs.map((c) => c.blockReadBytes)),
      blockWriteBytes: delta(cs.map((c) => c.blockWriteBytes)),
      restarts: restartsDuringRun(cs.map((c) => c.restarts)),
      oomKilled: cs.some((c) => c.oomKilled),
      unhealthySamples: cs.filter((c) => c.health && c.health !== 'healthy' && c.health !== 'none')
        .length,
      cpuMeanByPhase: byPhase((c) => c.cpuPct, 'mean'),
      memMaxByPhase: byPhase((c) => c.memBytes, 'max'),
    };
  });

  const errMap = new Map<string, ErrorGroup>();
  for (const e of events.filter((e) => e.kind === 'log-error')) {
    const c = String(e.container);
    const g = errMap.get(c) ?? { container: c, count: 0, examples: [] };
    g.count += 1;
    if (g.examples.length < 5) g.examples.push(`[${e.phase}] ${String(e.line)}`);
    errMap.set(c, g);
  }
  const errors = [...errMap.values()].sort((a, b) => b.count - a.count);

  const intervals = ok.map((s) => s.dt).filter((x): x is number => typeof x === 'number' && x > 0);
  const firstProbeError = ok.map((s) => s.latency?.error).find(Boolean);
  const summary: RunSummary = {
    ...(firstProbeError ? { probeError: firstProbeError } : {}),
    meta,
    sampling: {
      samples: samples.length,
      failed: samples.length - ok.length,
      medianIntervalSec: median(intervals),
    },
    phases: phaseSummaries,
    containers,
    errors,
    findings: [],
  };
  summary.findings = findings(summary);
  return summary;
}

/** Things worth a person's eye, worked out from the numbers. Not pass or fail: thresholds wait for real runs. */
export function findings(s: RunSummary): string[] {
  const f: string[] = [];
  if (s.sampling.failed > 0)
    f.push(
      `${s.sampling.failed} of ${s.sampling.samples} samples failed (the monitor could not reach the target); gaps are not filled in.`,
    );
  const swap = Math.max(0, ...s.phases.map((p) => p.swapUsedBytes?.max ?? 0));
  const start = s.phases[0]?.swapUsedBytes?.max ?? 0;
  // A few hundred KiB is the kernel parking idle pages, not pressure; a lot of swap is.
  if (swap > 64 * 1024 * 1024)
    f.push(
      `Swap was in use (up to ${fmtBytes(swap)}${start > 0 ? `, from ${fmtBytes(start)} at the start` : ''}): the machine ran short of memory at some point. Check \`swapon --show\`: swap held in compressed RAM (zram) costs CPU, not disk speed.`,
    );
  for (const c of s.containers) {
    if (c.oomKilled) f.push(`${c.name} was killed for running out of memory.`);
    if (c.restarts > 0) f.push(`${c.name} restarted ${c.restarts} time(s) during the run.`);
    if (c.unhealthySamples > 0)
      f.push(`${c.name} reported not healthy in ${c.unhealthySamples} sample(s).`);
  }
  for (const p of s.phases) {
    if (p.failedProbes > 0)
      f.push(
        `Phase ${p.name}: ${p.failedProbes} health probe(s) failed or returned an error status${s.probeError ? ` (first: ${s.probeError})` : ''}.`,
      );
    if (p.cpuPct && p.cpuPct.max > 90)
      f.push(`Phase ${p.name}: host CPU reached ${fmtNum(p.cpuPct.max, 0)} %.`);
  }
  const total = s.errors.reduce((a, e) => a + e.count, 0);
  if (total > 0)
    f.push(
      `${total} error or warning line(s) in the service logs, from ${s.errors.length} container(s): see the list below.`,
    );
  const failed = s.meta.checks.filter((c) => c.status === 'fail');
  for (const c of failed) f.push(`Check failed: ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  return f;
}

const sum = (x: Summary | undefined, f: (s: Summary) => string): string => (x ? f(x) : '–');
const cell = (s: string) => s.replace(/\|/g, '\\|');

export function renderReport(s: RunSummary): string {
  const m = s.meta;
  const L: string[] = [];
  const dur = (Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 1000;
  L.push(`# Validation run: ${m.label}`, '');
  if (m.mode === 'dry')
    L.push(
      `> **DRY RUN.** No audio, chat, soundboard or recording was made, and nothing was written to the server. The runner walked the planned timeline (${m.plan.length} session(s)) compressed ×${m.speed ?? '?'} while the monitor measured the real target, so the numbers below show **the server at idle** and the structure is what a live run produces. Rows that need a live run say so.`,
      '',
    );
  L.push('## The run', '', '| | |', '| --- | --- |');
  const rows: [string, string][] = [
    ['Mode', m.mode === 'dry' ? 'dry run' : 'live'],
    ['Target', m.target],
    ['Started', m.startedAt],
    ['Duration', fmtDuration(dur)],
    ['Server version', m.info.version ?? 'unknown'],
    ['CPU', `${m.info.cpu ?? 'unknown'} (${m.info.cores ?? '?'} cores)`],
    ['Memory', fmtBytes(Number(m.info.memory))],
    ['Kernel, Docker', `${m.info.kernel ?? '?'}, Docker ${m.info.docker ?? '?'}`],
    ['GPU', m.info.gpu ?? 'none seen'],
    [
      'Sampling',
      `every ${m.intervalMs / 1000} s (median real interval ${fmtNum(s.sampling.medianIntervalSec, 1)} s); ${s.sampling.samples} samples, ${s.sampling.failed} failed. A spike shorter than the interval is missed.`,
    ],
  ];
  for (const [k, v] of rows) L.push(`| ${k} | ${cell(v)} |`);
  L.push('');

  L.push('## Things to look at', '');
  if (s.findings.length === 0)
    L.push(
      'Nothing flagged by the automatic checks (swap, restarts, out-of-memory kills, unhealthy containers, failed probes, CPU above 90 %, error lines).',
      '',
    );
  else for (const x of s.findings) L.push(`- ${x}`);
  if (s.findings.length) L.push('');

  if (m.plan.length) {
    L.push(
      '## What was played',
      '',
      '| Session | Title | Planned length | Spoken | Typed | Scenes | Stingers | Loot | Recording actions |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const p of m.plan) {
      const c = p.counts;
      const rec = ['start', 'stop', 'pause', 'resume', 'late-join', 'leave', 'rejoin'].reduce(
        (a, k) => a + (c[k] ?? 0),
        0,
      );
      L.push(
        `| ${p.n} | ${p.title} | ${fmtDuration(p.estimatedSec)} | ${c.say ?? 0} | ${c.type ?? 0} | ${c.scene ?? 0} | ${c.stinger ?? 0} | ${c.loot ?? 0} | ${rec} |`,
      );
    }
    L.push('');
  }

  L.push(
    '## The host, by phase',
    '',
    '| Phase | Length | CPU mean / p95 / max | Load (1 min) max | Memory used mean / max | Swap max | Net in / out (rate max) | Net in / out (total) | Disk free change | Errors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const p of s.phases) {
    L.push(
      `| ${p.name} | ${fmtDuration(p.durationSec)} | ${sum(p.cpuPct, (x) => `${fmtNum(x.mean)} / ${fmtNum(x.p95)} / ${fmtNum(x.max)} %`)} | ${sum(p.load1, (x) => fmtNum(x.max, 2))} | ${sum(p.memUsedBytes, (x) => `${fmtBytes(x.mean)} / ${fmtBytes(x.max)}`)} | ${sum(p.swapUsedBytes, (x) => fmtBytes(x.max))} | ${fmtRate(p.netRxBps?.max)} / ${fmtRate(p.netTxBps?.max)} | ${fmtBytes(p.netRxBytes)} / ${fmtBytes(p.netTxBytes)} | ${fmtBytes(p.rootFreeBytesChange)} | ${p.errorLines} |`,
    );
  }
  L.push('');

  L.push(
    '## Latency to the server, by phase',
    '',
    "Round trip from the machine running the test to the server's URL (this includes any proxy or tunnel in front of it).",
    '',
    '| Phase | `/api/health` mean / p95 / max | `/api/status` mean / p95 / max | Failed probes |',
    '| --- | --- | --- | --- |',
  );
  for (const p of s.phases)
    L.push(
      `| ${p.name} | ${sum(p.healthMs, (x) => `${fmtNum(x.mean, 0)} / ${fmtNum(x.p95, 0)} / ${fmtNum(x.max, 0)} ms`)} | ${sum(p.statusMs, (x) => `${fmtNum(x.mean, 0)} / ${fmtNum(x.p95, 0)} / ${fmtNum(x.max, 0)} ms`)} | ${p.failedProbes} |`,
    );
  L.push('');

  L.push(
    '## The containers, whole run',
    '',
    '| Container | CPU mean / p95 / max | Memory mean / max (limit) | Net in / out | Disk read / written | Restarts | Out of memory |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const c of s.containers)
    L.push(
      `| ${c.name} | ${sum(c.cpuPct, (x) => `${fmtNum(x.mean, 2)} / ${fmtNum(x.p95, 2)} / ${fmtNum(x.max, 2)} %`)} | ${sum(c.memBytes, (x) => `${fmtBytes(x.mean)} / ${fmtBytes(x.max)}`)} (${c.memLimitBytes && c.memLimitBytes < 1e13 ? fmtBytes(c.memLimitBytes) : 'host'}) | ${fmtBytes(c.netRxBytes)} / ${fmtBytes(c.netTxBytes)} | ${fmtBytes(c.blockReadBytes)} / ${fmtBytes(c.blockWriteBytes)} | ${c.restarts} | ${c.oomKilled ? '**yes**' : 'no'} |`,
    );
  L.push('');

  const names = s.phases.map((p) => p.name);
  L.push(
    '### CPU by phase (mean % of one core, per container)',
    '',
    `| Container | ${names.join(' | ')} |`,
    `| --- | ${names.map(() => '---').join(' | ')} |`,
  );
  for (const c of s.containers)
    L.push(
      `| ${c.name} | ${names.map((n) => (c.cpuMeanByPhase[n] === undefined ? '–' : fmtNum(c.cpuMeanByPhase[n], 2))).join(' | ')} |`,
    );
  L.push(
    '',
    '### Memory by phase (peak, per container)',
    '',
    `| Container | ${names.join(' | ')} |`,
    `| --- | ${names.map(() => '---').join(' | ')} |`,
  );
  for (const c of s.containers)
    L.push(
      `| ${c.name} | ${names.map((n) => (c.memMaxByPhase[n] === undefined ? '–' : fmtBytes(c.memMaxByPhase[n]))).join(' | ')} |`,
    );
  L.push('');

  L.push('## Errors and warnings in the service logs', '');
  if (s.errors.length === 0)
    L.push(
      'None matched. (The monitor looks for error, warn, panic, fatal, out of memory, unhandled, exception, refused, timed out and failed; routine info lines and health probes are ignored.)',
      '',
    );
  else {
    L.push('| Container | Lines | First examples |', '| --- | --- | --- |');
    for (const e of s.errors)
      L.push(
        `| ${e.container} | ${e.count} | ${cell(e.examples.map((x) => x.slice(0, 160)).join(' ⏎ '))} |`,
      );
    L.push('');
  }

  if (m.scores?.length) {
    L.push(
      '## Scores',
      '',
      'Measured against the script. There are no pass marks yet: the first runs set them.',
      '',
      '| Score | Value | Detail |',
      '| --- | --- | --- |',
    );
    for (const x of m.scores)
      L.push(`| ${cell(x.name)} | ${cell(x.value)} | ${cell(x.detail ?? '')} |`);
    L.push('');
  }

  L.push('## Checks', '');
  if (m.checks.length === 0)
    L.push('No checks ran: a dry run has no recording, transcript or summary to check.', '');
  else {
    L.push('| Check | Result | Detail |', '| --- | --- | --- |');
    for (const c of m.checks)
      L.push(`| ${cell(c.name)} | ${c.status.toUpperCase()} | ${cell(c.detail ?? '')} |`);
    L.push('');
  }

  if (m.notMeasured.length) {
    L.push('## Not measured in this run', '');
    for (const x of m.notMeasured) L.push(`- ${x}`);
    L.push('');
  }
  if (m.notes.length) {
    L.push('## Notes', '');
    for (const x of m.notes) L.push(`- ${x}`);
    L.push('');
  }
  return L.join('\n');
}
