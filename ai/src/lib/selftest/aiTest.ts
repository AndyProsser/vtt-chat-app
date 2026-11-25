import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AiSettings, type TestRow } from '@vtt-chat-app/shared';

import { DEFAULT_CLAUDE_MODEL } from '../../consts/claude.js';
import { DEFAULT_OLLAMA_URL } from '../../consts/index.js';
import type { GenerateText, TranscribeWav } from '../../types/index.js';
import type { OllamaContextStatus } from '../../types/localAi.js';
import { createOllamaContextChecker } from '../localAi/contextChecker.js';
import { ollamaHasModel } from '../localAi/ollamaModel.js';
import { createOllamaGenerate } from '../ollama.js';
import { createClaudeGenerate } from '../providers/claude.js';
import { OPENAI_BASE_URL } from '../providers/fromSettings.js';
import { createOpenAiGenerate, createOpenAiTranscribe } from '../providers/openaiCompat.js';
import { stripThinking } from '../summarise.js';
import { contextWindowTokens, ollamaNumCtx } from '../tokenBudget.js';
import { aiTargets, type AiTarget, type AiTestFlags } from './aiTargets.js';
import { toneWav } from './toneWav.js';

type Usage = { model: string; inputTokens: number; outputTokens: number };
type Env = Record<string, string | undefined>;

export interface AiTestDeps {
  settings: AiSettings;
  /** The worker's environment: `WHISPER_LOCAL_URL`, `OLLAMA_URL`, `OLLAMA_MODEL` and the API keys. */
  env: Env;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** How long to wait for any one answer (default 3 minutes: a CPU-only model can be slow). */
  timeoutMs?: number;
  // The pieces below are the real thing unless a test supplies its own.
  transcribe?: (target: AiTarget) => TranscribeWav;
  generate?: (target: AiTarget, onUsage: (u: Usage) => void) => GenerateText;
  hasModel?: (baseUrl: string, model: string) => Promise<boolean>;
  contextCheck?: (o: { baseUrl: string; model: string }) => Promise<OllamaContextStatus>;
}

/** Longer than this for one word and a long session will take a long time, though it still works. */
const SLOW_MS = 60_000;
const PROMPT = 'Reply with the single word: ok';

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const messageOf = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 200);

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`did not answer within ${seconds(ms)}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const cloudKind = (s: AiSettings): 'claude' | 'openai' =>
  s.llm.kind === 'openai' ? 'openai' : 'claude';
const cloudKeyName = (s: AiSettings): string =>
  cloudKind(s) === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';

/** The real backends, built from the settings and the worker's environment, for whatever a test did not supply. */
function withDefaults(
  d: AiTestDeps,
): Required<Pick<AiTestDeps, 'transcribe' | 'generate' | 'hasModel' | 'contextCheck'>> {
  const { settings: s, env } = d;
  return {
    transcribe:
      d.transcribe ??
      ((t) =>
        createOpenAiTranscribe(
          t.where === 'local'
            ? {
                baseUrl: env.WHISPER_LOCAL_URL ?? 'http://127.0.0.1:8080',
                model: 'whisper-1',
                language: s.transcription.language,
                ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}),
              }
            : {
                baseUrl: s.transcription.url ?? '',
                model: s.transcription.model ?? 'whisper-1',
                language: s.transcription.language,
                ...(env.WHISPER_API_KEY ? { apiKey: env.WHISPER_API_KEY } : {}),
                ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}),
              },
        )),
    generate:
      d.generate ??
      ((t, onUsage) => {
        if (t.where === 'local') {
          return createOllamaGenerate({
            model: env.OLLAMA_MODEL ?? '',
            baseUrl: env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL,
            numCtx: ollamaNumCtx(s.llm),
            ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}),
          });
        }
        if (t.where === 'remote') {
          return createOpenAiGenerate({
            baseUrl: s.llm.url ?? '',
            model: s.llm.model ?? 'default',
            noThinking: true,
            ...(env.LLM_API_KEY ? { apiKey: env.LLM_API_KEY } : {}),
            ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}),
          });
        }
        return cloudKind(s) === 'claude'
          ? createClaudeGenerate({
              apiKey: env.ANTHROPIC_API_KEY ?? '',
              model: s.llm.model ?? DEFAULT_CLAUDE_MODEL,
              onUsage,
            })
          : createOpenAiGenerate({
              baseUrl: OPENAI_BASE_URL,
              apiKey: env.OPENAI_API_KEY ?? '',
              model: s.llm.model ?? '',
              noSampling: true,
              onUsage,
              ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}),
            });
      }),
    hasModel: d.hasModel ?? ((baseUrl, model) => ollamaHasModel(baseUrl, model, d.fetchImpl)),
    contextCheck:
      d.contextCheck ??
      ((o) =>
        createOllamaContextChecker({
          kind: 'remote',
          baseUrl: o.baseUrl,
          model: o.model,
          probeIfIdle: true,
          ...(d.fetchImpl ? { fetchImpl: d.fetchImpl } : {}),
        })),
  };
}

/**
 * `vtt-admin test ai`: proves the speech-to-text and the summary model each answer, and says how long they took, for what
 * is configured (never cloud AI unless asked, because that is a real call that costs a fraction of a cent) or for the
 * backends the flags name. It is a connection test, not a quality test: Whisper is given a tone, the model one word.
 */
export async function runAiTest(flags: AiTestFlags, deps: AiTestDeps): Promise<TestRow[]> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 180_000;
  const real = withDefaults(deps);
  const { targets, notes } = aiTargets(deps.settings, flags);
  const rows: TestRow[] = [...notes];

  for (const target of targets) {
    if (target.what === 'transcription') rows.push(await testTranscription(target));
    else rows.push(...(await testModel(target)));
  }
  if (targets.length === 0 && notes.length === 0) {
    rows.push({ badge: 'off', name: 'AI', detail: 'nothing to test' });
  }
  return rows;

  async function testTranscription(target: AiTarget): Promise<TestRow> {
    const name = `Whisper (${target.where})`;
    if (target.where === 'remote' && !deps.settings.transcription.url) {
      return { badge: 'fail', name, detail: 'ai.transcription.url is not set' };
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'vtt-test-'));
    try {
      const wav = path.join(dir, 'tone.wav');
      await writeFile(wav, toneWav(1));
      const started = now();
      const segments = await withTimeout(real.transcribe(target)(wav), timeoutMs);
      return {
        badge: 'ok',
        name,
        detail: `answered in ${seconds(now() - started)} (a test tone, ${segments.length === 0 ? 'no words heard, as expected' : `${segments.length} segment${segments.length === 1 ? '' : 's'}`})`,
      };
    } catch (e) {
      return { badge: 'fail', name, detail: `did not work: ${messageOf(e)}` };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function testModel(target: AiTarget): Promise<TestRow[]> {
    const s = deps.settings;
    const name =
      target.where === 'cloud'
        ? `Summary model (cloud: ${cloudKind(s)})`
        : `Summary model (${target.where})`;
    let model: string;
    if (target.where === 'local') {
      model = deps.env.OLLAMA_MODEL ?? '';
      if (!model)
        return [{ badge: 'fail', name, detail: 'OLLAMA_MODEL is not set for the worker' }];
      const url = deps.env.OLLAMA_URL ?? DEFAULT_OLLAMA_URL;
      try {
        if (!(await withTimeout(real.hasModel(url, model), 15_000))) {
          return [
            {
              badge: 'fail',
              name,
              detail: `${model} is not downloaded yet. It downloads in the background after install; watch it with: vtt-admin logs worker`,
            },
          ];
        }
      } catch (e) {
        return [
          { badge: 'fail', name, detail: `Ollama at ${url} did not answer: ${messageOf(e)}` },
        ];
      }
    } else if (target.where === 'remote') {
      if (!s.llm.url || !s.llm.model) {
        return [{ badge: 'fail', name, detail: 'ai.llm.url and ai.llm.model are not both set' }];
      }
      model = s.llm.model;
    } else {
      const keyName = cloudKeyName(s);
      if (!deps.env[keyName]) {
        return [{ badge: 'fail', name, detail: `${keyName} is not set, so nothing was called` }];
      }
      model = s.llm.model ?? (cloudKind(s) === 'claude' ? DEFAULT_CLAUDE_MODEL : '');
    }

    let usage: Usage | undefined;
    const rows: TestRow[] = [];
    try {
      const started = now();
      const text = stripThinking(
        await withTimeout(real.generate(target, (u) => (usage = u))(PROMPT), timeoutMs),
      ).trim();
      const took = now() - started;
      if (!text) {
        rows.push({ badge: 'fail', name, detail: `${model} answered with no text` });
      } else {
        const used = usage ? `, ${usage.inputTokens} in / ${usage.outputTokens} out tokens` : '';
        rows.push({
          badge: took > SLOW_MS ? 'warn' : 'ok',
          name,
          detail:
            took > SLOW_MS
              ? `${model} answered in ${seconds(took)}: slow. It works, but a long session will take a long time to write up${used}`
              : `${model} answered in ${seconds(took)}${used}`,
        });
      }
    } catch (e) {
      return [{ badge: 'fail', name, detail: `${model} did not work: ${messageOf(e)}` }];
    }

    if (target.where === 'remote' && s.llm.url) {
      // The model is loaded now, so what the server really serves can be read.
      const configured = contextWindowTokens(s.llm, false);
      try {
        const status = await withTimeout(real.contextCheck({ baseUrl: s.llm.url, model }), 60_000);
        if (status.live === undefined) {
          rows.push({
            badge: 'warn',
            name: 'Summary model window (remote)',
            detail: `could not read the window the server is serving; ${configured} is configured`,
          });
        } else if (status.live < configured) {
          rows.push({
            badge: 'fail',
            name: 'Summary model window (remote)',
            detail: `the server is serving only ${status.live} tokens but ${configured} is configured: long sessions would be cut short. Lower ai.llm.context or raise the server's OLLAMA_CONTEXT_LENGTH`,
          });
        } else {
          rows.push({
            badge: 'ok',
            name: 'Summary model window (remote)',
            detail: `the server is serving ${status.live} tokens (${configured} configured)`,
          });
        }
      } catch (e) {
        rows.push({
          badge: 'warn',
          name: 'Summary model window (remote)',
          detail: `could not read it: ${messageOf(e)}`,
        });
      }
    }
    return rows;
  }
}
