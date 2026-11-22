// Tests for the runner's pure parts: the parsers of what a target prints, the statistics, the plan and the report.
// Run: node --test infra/records-smoke/validation/validation.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { load, stats, validate } from '../campaign-fixture.ts';
import type { RunEvent, Sample } from './monitor.ts';
import {
  cpuPercent,
  parseBytes,
  parseDf,
  parseDockerStats,
  parseInspect,
  parseLoadAvg,
  parseLogLines,
  parseMeminfo,
  parseNetDev,
  parseProcStat,
  splitSections,
} from './parse.ts';
import { planCampaign } from './plan.ts';
import { renderReport, summarise_run, type RunMeta } from './report.ts';
import { fmtBytes, fmtDuration, percentile, summarise } from './stats.ts';

test('parseBytes reads docker and binary units', () => {
  assert.equal(parseBytes('0B'), 0);
  assert.equal(parseBytes('1.5kB'), 1500);
  assert.equal(parseBytes('1KiB'), 1024);
  assert.equal(parseBytes('2.5MiB'), 2.5 * 1024 ** 2);
  assert.equal(parseBytes('23.5GiB'), 23.5 * 1024 ** 3);
  assert.ok(Number.isNaN(parseBytes('lots')));
});

test('CPU percent comes from two /proc/stat readings', () => {
  const a = parseProcStat('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 1 1 1');
  const b = parseProcStat('cpu  150 0 150 900 0 0 0 0 0 0\ncpu0 1 1 1 1');
  assert.ok(a && b);
  assert.equal(cpuPercent(a, b), 50); // 100 busy of 200 total
  assert.equal(cpuPercent(a, a), undefined);
  assert.equal(parseProcStat('nonsense'), undefined);
});

test('load, memory, network and disk readings', () => {
  assert.deepEqual(parseLoadAvg('0.38 0.13 0.05 1/300 12345'), {
    load1: 0.38,
    load5: 0.13,
    load15: 0.05,
  });
  const mem = parseMeminfo(
    'MemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 200 kB\nSwapFree: 150 kB\n',
  );
  assert.equal(mem?.usedBytes, 600 * 1024);
  assert.equal(mem?.swapUsedBytes, 50 * 1024);
  const net = parseNetDev(
    [
      'Inter-|   Receive                                                |  Transmit',
      '    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0',
      ' ens18: 1000 5 0 0 0 0 0 0 2000 6 0 0 0 0 0 0',
      'docker0: 5000 1 0 0 0 0 0 0 5000 1 0 0 0 0 0 0',
      'veth1a: 7 1 0 0 0 0 0 0 7 1 0 0 0 0 0 0',
    ].join('\n'),
  );
  assert.deepEqual(net, { rxBytes: 1000, txBytes: 2000 });
  const df = parseDf(
    'Mounted on     1B-blocks       Avail\n/            82000000000 43000000000\n/var/lib/docker 82000000000 43000000000\n',
  );
  assert.equal(df[0]?.mount, '/');
  assert.equal(df[0]?.availBytes, 43_000_000_000);
});

test('docker stats and inspect lines', () => {
  const stats = parseDockerStats(
    'vtt-backend-1|0.17%|88.5MiB / 23.5GiB|1.2MB / 3.4MB|0B / 4.1kB|23\nvtt-whisper-1|312.50%|1.9GiB / 23.5GiB|0B / 0B|2.2GB / 1MB|9\njunk',
  );
  assert.equal(stats.length, 2);
  assert.equal(stats[0]?.cpuPct, 0.17);
  assert.equal(stats[0]?.netRxBytes, 1_200_000);
  assert.equal(stats[1]?.cpuPct, 312.5);
  assert.equal(stats[1]?.memBytes, 1.9 * 1024 ** 3);
  const st = parseInspect('/vtt-backend-1|false|0|healthy\n/vtt-worker-1|true|3|none');
  assert.equal(st[1]?.oomKilled, true);
  assert.equal(st[1]?.restarts, 3);
  assert.equal(st[0]?.name, 'vtt-backend-1');
});

test('log lines and the sampler sections', () => {
  const lines = parseLogLines(
    'vtt-worker-1|2026-11-21T06:00:00Z ERROR job failed: a|b\nnot a row\nvtt-backend-1|warn x',
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.line, '2026-11-21T06:00:00Z ERROR job failed: a|b');
  const sec = splitSections('@@TS\n123\n@@STAT\ncpu 1 2 3 4 5\n@@LOGS\n');
  assert.equal(sec.TS?.trim(), '123');
  assert.equal(sec.LOGS, '');
});

test('percentiles are values that were seen', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(v, 95), 10);
  assert.equal(percentile(v, 50), 5);
  const s = summarise([5, undefined, 1, 3, Number.NaN]);
  assert.deepEqual(s && [s.n, s.min, s.mean, s.max], [3, 1, 3, 5]);
  assert.equal(summarise([]), undefined);
  assert.equal(fmtBytes(1536), '1.5 KiB');
  assert.equal(fmtDuration(125), '2 min 5 s');
});

test("the plan matches the fixtures and the validator's estimate", async () => {
  const l = await load();
  const r = validate(l);
  const plan = planCampaign(l, r);
  assert.equal(plan.length, 4);
  const rows = stats(l, r);
  for (const p of plan) {
    const [min, max] = l.campaign.sessions.find((x) => x.n === p.n)?.extended ? [60, 95] : [20, 40];
    assert.ok(
      p.estimatedSec > min * 60 && p.estimatedSec < max * 60,
      `session ${p.n}: ${p.estimatedSec} s`,
    );
    // Steps are in time order and add up to the session's length.
    for (let i = 1; i < p.steps.length; i += 1)
      assert.ok((p.steps[i]?.atSec ?? 0) >= (p.steps[i - 1]?.atSec ?? 0));
    const row = rows.find((x) => x.n === p.n)!;
    assert.equal(p.counts.say, row.spokenLines);
    assert.equal(p.counts.scene, row.scenes);
  }
  assert.deepEqual(
    planCampaign(l, r, [2]).map((p) => p.n),
    [2],
  );
});

const meta = (over: Partial<RunMeta> = {}): RunMeta => ({
  mode: 'dry',
  target: 'test',
  label: 't',
  startedAt: '2026-11-21T06:00:00.000Z',
  endedAt: '2026-11-21T06:01:00.000Z',
  info: { cpu: 'Test CPU', cores: '4', memory: String(8 * 1024 ** 3), version: 'v1' },
  intervalMs: 5000,
  speed: 60,
  plan: [],
  checks: [],
  notes: [],
  notMeasured: ['everything live'],
  ...over,
});

const sample = (tMs: number, phase: string, over: Partial<Sample> = {}): Sample => ({
  t: new Date(tMs).toISOString(),
  tMs,
  phase,
  dt: 5,
  host: {
    cpuPct: 10,
    memUsedBytes: 2 * 1024 ** 3,
    swapUsedBytes: 0,
    netRxBytes: tMs,
    netTxBytes: tMs / 2,
  },
  disks: [{ mount: '/', sizeBytes: 100, availBytes: 50 }],
  containers: [
    {
      name: 'vtt-worker-1',
      cpuPct: 5,
      memBytes: 1e8,
      memLimitBytes: 1e10,
      netRxBytes: 0,
      netTxBytes: 0,
      blockReadBytes: 0,
      blockWriteBytes: 0,
      pids: 3,
      oomKilled: false,
      restarts: 0,
      health: 'none',
    },
  ],
  latency: { healthMs: 20, healthStatus: 200, statusMs: 30 },
  ...over,
});

test('the summary groups by phase and flags what needs a look', () => {
  const t = Date.parse('2026-11-21T06:00:00.000Z');
  const events: RunEvent[] = [
    { t: new Date(t).toISOString(), phase: 'baseline', kind: 'phase', name: 'baseline' },
    {
      t: new Date(t + 20_000).toISOString(),
      phase: 'session-1-recording',
      kind: 'phase',
      name: 'session-1-recording',
    },
    {
      t: new Date(t + 25_000).toISOString(),
      phase: 'session-1-recording',
      kind: 'log-error',
      container: 'vtt-worker-1',
      line: 'ERROR boom',
    },
  ];
  const samples: Sample[] = [
    sample(t, 'baseline'),
    sample(t + 10_000, 'baseline'),
    sample(t + 20_000, 'session-1-recording', {
      host: { cpuPct: 95, memUsedBytes: 4 * 1024 ** 3, swapUsedBytes: 200 * 1024 ** 2 },
      containers: [
        {
          name: 'vtt-worker-1',
          cpuPct: 300,
          memBytes: 3e9,
          memLimitBytes: 1e10,
          netRxBytes: 0,
          netTxBytes: 0,
          blockReadBytes: 0,
          blockWriteBytes: 0,
          pids: 3,
          oomKilled: true,
          restarts: 1,
          health: 'unhealthy',
        },
      ],
    }),
    sample(t + 30_000, 'session-1-recording', {
      latency: { error: 'fetch failed: CERT_HAS_EXPIRED' },
    }),
    sample(t + 40_000, 'session-1-recording', { failure: 'ssh: timed out' }),
  ];
  const s = summarise_run(samples, events, meta());
  assert.deepEqual(
    s.phases.map((p) => p.name),
    ['baseline', 'session-1-recording'],
  );
  assert.equal(s.phases[0]?.cpuPct?.mean, 10);
  assert.equal(s.phases[1]?.cpuPct?.max, 95);
  assert.equal(s.phases[1]?.errorLines, 1);
  assert.equal(s.sampling.failed, 1);
  const text = s.findings.join('\n');
  assert.match(text, /1 of 5 samples failed/);
  assert.match(text, /Swap was in use/);
  assert.match(text, /vtt-worker-1 was killed for running out of memory/);
  assert.match(text, /vtt-worker-1 restarted 1 time/);
  assert.match(text, /CERT_HAS_EXPIRED/);
  assert.match(text, /host CPU reached 95 %/);
});

test('an idle run flags nothing; tiny swap is not pressure', () => {
  const t = Date.parse('2026-11-21T06:00:00.000Z');
  const events: RunEvent[] = [
    { t: new Date(t).toISOString(), phase: 'baseline', kind: 'phase', name: 'baseline' },
  ];
  const samples = [0, 5, 10].map((s) =>
    sample(t + s * 1000, 'baseline', { host: { cpuPct: 3, swapUsedBytes: 788 * 1024 } }),
  );
  assert.deepEqual(summarise_run(samples, events, meta()).findings, []);
});

test('the report says it is a dry run, and lists what it did not measure', () => {
  const t = Date.parse('2026-11-21T06:00:00.000Z');
  const events: RunEvent[] = [
    { t: new Date(t).toISOString(), phase: 'baseline', kind: 'phase', name: 'baseline' },
  ];
  const md = renderReport(
    summarise_run([sample(t, 'baseline'), sample(t + 5000, 'baseline')], events, meta()),
  );
  assert.match(md, /^# Validation run: t/);
  assert.match(md, /\*\*DRY RUN\.\*\*/);
  for (const h of [
    '## The run',
    '## Things to look at',
    '## The host, by phase',
    '## Latency to the server, by phase',
    '## The containers, whole run',
    '## Errors and warnings',
    '## Checks',
    '## Not measured in this run',
  ])
    assert.ok(md.includes(h), h);
  assert.match(md, /vtt-worker-1/);
  const live = renderReport(summarise_run([sample(t, 'baseline')], events, meta({ mode: 'live' })));
  assert.doesNotMatch(live, /DRY RUN/);
});
