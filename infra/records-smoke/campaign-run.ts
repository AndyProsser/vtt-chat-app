// The runner and monitor for the demo campaign (Stage 13; docs/architecture/QUALITY-VALIDATION.md).
//
//   node infra/records-smoke/campaign-run.ts dry    [options]   walk the plan compressed while measuring the real target
//   node infra/records-smoke/campaign-run.ts live   [options]   play the sessions into a real server, wait for the records, score them
//   node infra/records-smoke/campaign-run.ts report <run dir>   write report.md again from a finished run's files
//
// Options (dry):
//   --target local|vm   which machine to measure (default local). `vm` needs VTT_VM_SSH and VTT_API (see validation/target.ts)
//   --sessions 1,2,3    which sessions to walk (default all)
//   --speed 60          how much faster than real time the plan is walked (default 60)
//   --interval 2        seconds between samples (default 2)
//   --baseline 30  --processing 10  --idle 30    seconds of the idle, per-session processing and after-run phases
//   --label name        a word for the results folder
//   --out dir           results folder (default ~/.local/state/vtt-validation/<time>-<target>-<label>)
//
// Options (live), besides --target, --sessions, --interval, --label and --out:
//   --glossary off|corrections|prompt|both|keep   the transcription glossary mode for the run (default keep)
//   --no-observer       do not wait for player 5 (the developer) to join (default wait: 10 minutes)
//   --resume <id>       carry on in an existing campaign (no new accounts, glossary or notes, no waiting for player 5)
//   --collect 1,2       sessions already played: wait for their processing and score them, without playing them
//   --no-overlap        play the last session only after the one before is processed (default: start it at once)
//   --restore-glossary <mode>   what the glossary mode goes back to at the end
//   --max-lines N       play only the first N lines of each session (a smoke test of the machinery)
//   --timeout-min 90    how long to wait for each recording to be processed
//   --baseline 60  --idle 120   seconds of idle before and after
// A live run creates five accounts (lanterns-*@example.com) and a campaign on the target, and leaves them there.
// Set NODE_EXTRA_CA_CERTS for a server with a private certificate.
//
// A dry run sends nothing to the server: no accounts, no chat, no recording. It measures the target at idle and
// writes the same files and report a live run does, so the report can be reviewed before any audio plays.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { DEFAULT_DIR, load, validate } from './campaign-fixture.ts';
import { runLive } from './validation/live.ts';
import { Monitor, type RunEvent, type Sample } from './validation/monitor.ts';
import { planCampaign } from './validation/plan.ts';
import { renderReport, summarise_run, type RunMeta } from './validation/report.ts';
import { targetByName, type Target } from './validation/target.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (line: string) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${line}`);

const stamp = (d = new Date()) =>
  d.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

async function dry(): Promise<void> {
  const targetName = opt('--target') ?? 'local';
  const speed = Number(opt('--speed') ?? 60);
  const intervalMs = Number(opt('--interval') ?? 2) * 1000;
  const baselineSec = Number(opt('--baseline') ?? 30);
  const processingSec = Number(opt('--processing') ?? 10);
  const idleSec = Number(opt('--idle') ?? 30);
  const sessions = opt('--sessions')?.split(',').map(Number);
  const label = opt('--label') ?? 'dry';
  const root =
    process.env.VTT_VALIDATION_DIR ?? path.join(homedir(), '.local/state/vtt-validation');
  const outDir = opt('--out') ?? path.join(root, `${stamp()}-${targetName}-${label}`);

  const l = await load(DEFAULT_DIR);
  const v = validate(l);
  if (v.errors.length) {
    for (const e of v.errors) console.error(`fixture error: ${e}`);
    throw new Error('the campaign fixtures are not valid: run `npm run campaign:check`');
  }
  const plan = planCampaign(l, v, sessions);
  const target: Target = targetByName(targetName);
  const monitor = new Monitor({ target, outDir, intervalMs, log });
  const startedAt = new Date().toISOString();
  let stopping = false;
  const finish = async (note?: string) => {
    if (stopping) return;
    stopping = true;
    await monitor.stop();
    await target.close();
    const meta: RunMeta = {
      mode: 'dry',
      target: `${target.label} (${target.kind === 'ssh' ? 'remote host over SSH' : 'this machine'})`,
      label,
      startedAt,
      endedAt: new Date().toISOString(),
      info: monitor.info,
      intervalMs,
      speed,
      plan,
      checks: [],
      notes: [
        `The monitor's own cost is part of the numbers: each sample runs \`docker stats\` and a few reads on the target, which costs a little CPU (the baseline phase shows the floor). A longer interval costs less and sees less.`,
        `The plan was walked ×${speed}: each session's recording phase lasts its planned length divided by ${speed}, and every planned line, scene, stinger and loot drop is written to events.jsonl at its compressed time.`,
        ...(note ? [note] : []),
      ],
      notMeasured: [
        'Speech into the voice room, recording, transcription and summaries: no audio was played, so there is no Whisper or model load to see.',
        'Chat, soundboard and loot traffic, and the latency of chat and voice: nothing was sent.',
        'Per-job timings, model tokens and cost: no job ran.',
        'The desktop app (player 5): no client joined.',
        'Fact, canary, glossary, callback and word-accuracy scores: there is nothing to score until a live run.',
      ],
    };
    await writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
    const summary = summarise_run(monitor.samples, monitor.events, meta);
    await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    await writeFile(path.join(outDir, 'report.md'), renderReport(summary));
    log(`wrote ${path.join(outDir, 'report.md')}`);
    for (const f of summary.findings) log(`finding: ${f}`);
  };
  process.once(
    'SIGINT',
    () => void finish('Interrupted (Ctrl+C): the run is partial.').then(() => process.exit(130)),
  );

  log(
    `dry run against ${target.label}: ${plan.length} session(s), ×${speed}, sampling every ${intervalMs / 1000} s`,
  );
  await mkdir(outDir, { recursive: true });
  await monitor.start();
  await monitor.setPhase('baseline', 'idle before anything starts');
  log(`baseline ${baselineSec} s`);
  await sleep(baselineSec * 1000);
  for (const s of plan) {
    await monitor.setPhase(
      `session-${s.n}-recording`,
      `${s.title}: planned ${Math.round(s.estimatedSec / 60)} min`,
    );
    const start = Date.now();
    log(
      `session ${s.n} "${s.title}": ${Math.round(s.estimatedSec / speed)} s for ${s.steps.length} planned steps`,
    );
    for (const step of s.steps) {
      const due = start + (step.atSec / speed) * 1000;
      if (due > Date.now()) await sleep(due - Date.now());
      await monitor.event('planned', {
        session: s.n,
        at: Math.round(step.atSec),
        step: step.kind,
        ...(step.who ? { who: step.who } : {}),
        ...(step.arg ? { arg: step.arg } : {}),
        ...(step.text ? { text: step.text.slice(0, 60) } : {}),
        ...(step.expect ? { expect: step.expect } : {}),
      } satisfies Omit<RunEvent, 't' | 'phase' | 'kind'>);
    }
    await monitor.setPhase(
      `session-${s.n}-processing`,
      'a live run waits here for transcription and summaries',
    );
    log(`session ${s.n} processing (placeholder ${processingSec} s)`);
    await sleep(processingSec * 1000);
  }
  await monitor.setPhase('idle-after', 'after the last job');
  log(`idle-after ${idleSec} s`);
  await sleep(idleSec * 1000);
  await finish();
}

async function live(): Promise<void> {
  const targetName = opt('--target') ?? 'local';
  const intervalMs = Number(opt('--interval') ?? 5) * 1000;
  const baselineSec = Number(opt('--baseline') ?? 60);
  const idleSec = Number(opt('--idle') ?? 120);
  const sessions = opt('--sessions')?.split(',').map(Number) ?? [1, 2, 3];
  const label = opt('--label') ?? 'live';
  const root =
    process.env.VTT_VALIDATION_DIR ?? path.join(homedir(), '.local/state/vtt-validation');
  const outDir = opt('--out') ?? path.join(root, `${stamp()}-${targetName}-${label}`);
  const maxLines = opt('--max-lines') ? Number(opt('--max-lines')) : undefined;

  const l = await load(DEFAULT_DIR);
  const v = validate(l);
  if (v.errors.length)
    throw new Error('the campaign fixtures are not valid: run `npm run campaign:check`');
  const plan = planCampaign(l, v, sessions);
  const target = targetByName(targetName);
  const monitor = new Monitor({ target, outDir, intervalMs, log });
  const startedAt = new Date().toISOString();
  await mkdir(outDir, { recursive: true });
  let result: Awaited<ReturnType<typeof runLive>> | undefined;
  let failure: string | undefined;
  await monitor.start();
  try {
    await monitor.setPhase('baseline', 'idle before anything starts');
    log(`baseline ${baselineSec} s`);
    await sleep(baselineSec * 1000);
    result = await runLive({
      target,
      monitor,
      loaded: l,
      report: v,
      plan,
      sessions,
      outDir,
      runLabel: `${label} ${stamp().slice(4, 13)}`,
      glossary: opt('--glossary') ?? 'keep',
      waitForObserver: !argv.includes('--no-observer'),
      ...(opt('--resume') ? { resume: opt('--resume') as string } : {}),
      ...(opt('--collect') ? { collect: (opt('--collect') as string).split(',').map(Number) } : {}),
      overlapLast: !argv.includes('--no-overlap'),
      ...(opt('--restore-glossary')
        ? { restoreGlossary: opt('--restore-glossary') as string }
        : {}),
      ...(maxLines !== undefined ? { maxLines } : {}),
      timeoutMin: Number(opt('--timeout-min') ?? 90),
      log,
    });
    await monitor.setPhase('idle-after', 'after the last job');
    log(`idle-after ${idleSec} s`);
    await sleep(idleSec * 1000);
  } catch (e) {
    failure = (e as Error).message;
    log(`the run stopped: ${failure}`);
  }
  await monitor.stop();
  await target.close();
  const meta: RunMeta = {
    mode: 'live',
    target: `${target.label} (${target.kind === 'ssh' ? 'remote host over SSH' : 'this machine'})`,
    label,
    startedAt,
    endedAt: new Date().toISOString(),
    info: monitor.info,
    intervalMs,
    plan,
    checks: [
      ...(result?.checks ?? []),
      ...(failure ? [{ name: 'the run finished', status: 'fail' as const, detail: failure }] : []),
    ],
    scores: result?.scores ?? [],
    notes: [
      "The monitor's own cost is part of the numbers (each sample runs `docker stats` and a few reads on the target).",
      ...(maxLines
        ? [`Smoke test: only the first ${maxLines} lines of each session were played.`]
        : []),
      ...(result?.notes ?? []),
    ],
    notMeasured: [
      'Whether the tales are good: read outputs/session-N-summaries.md. Facts and canaries are scored by code; flavour is not.',
      'The desktop app (player 5): its own CPU and memory come from the measuring scripts in scripts/test, not from this run.',
    ],
  };
  await writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  const summary = summarise_run(monitor.samples, monitor.events, meta);
  await writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(path.join(outDir, 'report.md'), renderReport(summary));
  log(`wrote ${path.join(outDir, 'report.md')}`);
  if (failure || meta.checks.some((c) => c.status === 'fail')) process.exitCode = 1;
}

async function report(): Promise<void> {
  const dir = argv[1];
  if (!dir) throw new Error('usage: campaign-run.ts report <run dir>');
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as RunMeta;
  const lines = async (f: string) =>
    (await readFile(path.join(dir, f), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((x) => JSON.parse(x) as unknown);
  const summary = summarise_run(
    (await lines('samples.jsonl')) as Sample[],
    (await lines('events.jsonl')) as RunEvent[],
    meta,
  );
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(path.join(dir, 'report.md'), renderReport(summary));
  log(`wrote ${path.join(dir, 'report.md')}`);
}

try {
  if (cmd === 'dry') await dry();
  else if (cmd === 'live') {
    await live();
    // The voice client leaves sockets open that would keep the process alive: the report is written, so end here.
    process.exit(process.exitCode ?? 0);
  } else if (cmd === 'report') await report();
  else {
    console.error(
      'usage: campaign-run.ts dry|live|report [options]  (see the header of this file)',
    );
    process.exit(2);
  }
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
