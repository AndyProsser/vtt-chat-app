// Compares summary models on ONE transcript, through the worker's own code (planSummaries + summarise +
// the Ollama client): time per summary, model calls, peak VRAM, and the text, written out for reading.
//
//   node infra/records-smoke/llm-bench.ts --transcript <transcript-<id>.json> --gm <account id> \
//        --model granite4.1:3b --model qwen3:8b [--story-model gemma3:4b …] [--ollama http://127.0.0.1:11434]
//        [--out DIR] [--cpu]
//
// A summary is two passes (ai/src/lib/prompts.ts): a scribe takes notes of the transcript once, then a bard tells
// each tale from the notes. Without --story-model every --model plays both roles in turn. With it, the FIRST
// --model is the scribe and each --story-model is tried as the bard on the same kind of notes.
//
// The transcript is what compose-e2e.ts saves from the Records API (`transcript-<recording>.json`, in
// E2E_STATE); `--gm` is the DM's account id (everyone else counts as a player, so gets a character
// summary). Every model is asked to unload right after (keep_alive 0) so runs do not share VRAM.
// Judge the output yourself: faithfulness, structure, invented events, who did what.

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  createOllamaGenerate,
  planSummaries,
  takeNotes,
  writeFromNotes,
  type Utterance,
} from '@vtt-chat-app/ai';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const options = (name: string) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]!] : []));
const transcriptFile = options('--transcript')[0];
const gm = options('--gm')[0];
const models = options('--model');
const storyModels = options('--story-model');
const baseUrl = options('--ollama')[0] ?? 'http://127.0.0.1:11434';
if (!transcriptFile || !gm || models.length === 0) {
  throw new Error('usage: --transcript <file> --gm <dm account id> --model <name> [--model …]');
}
const cpu = argv.includes('--cpu');
const out =
  options('--out')[0] ??
  path.join(path.dirname(transcriptFile), cpu ? 'llm-bench-cpu' : 'llm-bench');

/** With --cpu, asks Ollama to keep every layer off the GPU (what a CPU-only server does). */
const cpuFetch: typeof fetch = async (input, init) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { options?: Record<string, unknown> };
  body.options = { ...body.options, num_gpu: 0 };
  return fetch(input, { ...init, body: JSON.stringify(body) });
};

async function vram(): Promise<number> {
  const { stdout } = await run('nvidia-smi', [
    '--query-gpu=memory.used',
    '--format=csv,noheader,nounits',
  ]).catch(() => ({ stdout: '0' }));
  return Number(stdout.trim()) || 0;
}

async function main(): Promise<void> {
  const utterances = JSON.parse(await readFile(transcriptFile!, 'utf8')) as Utterance[];
  const playerIds = new Set(utterances.map((u) => u.speaker.id).filter((id) => id !== gm));
  // The recording's own pause is not in the transcript file; for a chapter, split it in half.
  const middle = utterances[Math.floor(utterances.length / 2)]?.startMs ?? 0;
  const plan = planSummaries({
    utterances,
    events: [
      { recordingId: 'r', at: 0, event: 'started' },
      { recordingId: 'r', at: middle, event: 'resumed' },
    ],
    startedAt: 0,
    playerIds,
    campaignName: 'E2E: The Sunken Temple',
  });
  // One of each kind is enough to compare models.
  const kinds = new Set<string>();
  const sample = plan.filter((p) => !kinds.has(p.kind) && kinds.add(p.kind));
  await mkdir(out, { recursive: true });
  const results = [];
  const generator = (model: string) =>
    createOllamaGenerate({
      model,
      baseUrl,
      numCtx: 8192,
      keepAlive: '0',
      ...(cpu ? { fetchImpl: cpuFetch } : {}),
    });
  const scribeModel = models[0]!;
  const pairs =
    storyModels.length > 0
      ? storyModels.map((bard) => ({ scribe: scribeModel, bard }))
      : models.map((m) => ({ scribe: m, bard: m }));
  for (const pair of pairs) {
    const name = pair.scribe === pair.bard ? pair.scribe : `${pair.scribe} + ${pair.bard}`;
    const scribe = generator(pair.scribe);
    const bard = generator(pair.bard);
    const base = await vram();
    let peak = base;
    const timer = setInterval(() => void vram().then((v) => (peak = Math.max(peak, v))), 500);
    const texts: string[] = [];
    const timings: Record<string, number> = {};
    const timed = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      const value = await work();
      timings[label] = Number(((Date.now() - started) / 1000).toFixed(1));
      return value;
    };
    await timed('load', () => scribe('Reply with OK.')); // the model load, timed on its own
    // Notes once, as the records job does; every summary below is written from them.
    const all = plan[0]!;
    const taken = await timed('notes', () =>
      takeNotes(scribe, all.utterances, { context: all.context }),
    );
    texts.push(
      `## notes (${timings.notes} s, ${taken.modelCalls} call(s))\n\n${taken.notes.join('\n\n')}\n`,
    );
    for (const p of sample) {
      const label = `${p.kind}${p.subject ? `-${p.subject}` : ''}`;
      const result = await timed(label, () =>
        writeFromNotes({ scribe, bard }, taken.notes, { kind: p.kind, context: p.context }),
      );
      const words = result.text.split(/\s+/).length;
      texts.push(`## ${label} (${timings[label]} s, ${words} words)\n\n${result.text}\n`);
    }
    clearInterval(timer);
    const file = path.join(out, `${name.replace(/[^a-z0-9.]+/gi, '_')}.md`);
    await writeFile(file, `# ${name}\n\n${texts.join('\n')}`);
    const row = {
      model: name,
      seconds: timings,
      peakVramMiB: peak,
      vramOverIdleMiB: peak - base,
      file,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
  await writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
