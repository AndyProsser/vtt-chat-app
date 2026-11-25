import { DEFAULT_AI_SETTINGS, type AiSettings } from '@vtt-chat-app/shared';
import { describe, expect, it, vi } from 'vitest';

import type { OllamaContextStatus } from '../../types/localAi.js';
import { runAiTest, type AiTestDeps } from './aiTest.js';

const NONE = { local: false, remote: false, cloud: false };
const settings = (
  llm: Partial<AiSettings['llm']> = {},
  transcription: Partial<AiSettings['transcription']> = {},
): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  llm: { ...DEFAULT_AI_SETTINGS.llm, ...llm },
  transcription: { ...DEFAULT_AI_SETTINGS.transcription, ...transcription },
});

/** Fakes for everything outside: the clock ticks one second a look, so every step "takes" a second. */
function deps(over: Partial<AiTestDeps> = {}): AiTestDeps & { calls: string[] } {
  const calls: string[] = [];
  let t = 0;
  return {
    calls,
    settings: settings(),
    env: {
      OLLAMA_MODEL: 'qwen3:8b',
      WHISPER_LOCAL_URL: 'http://whisper:8080',
      OLLAMA_URL: 'http://ollama:11434',
    },
    now: () => (t += 1000),
    transcribe: (target) => async () => {
      calls.push(`transcribe:${target.where}`);
      return [];
    },
    generate: (target) => async () => {
      calls.push(`generate:${target.where}`);
      return 'ok';
    },
    hasModel: async () => true,
    contextCheck: async () => ({
      kind: 'remote',
      model: 'q',
      unreachable: false,
      checkedAt: 0,
      live: 12288,
    }),
    timeoutMs: 1000,
    ...over,
  };
}
const row = (rows: Awaited<ReturnType<typeof runAiTest>>, name: RegExp) =>
  rows.find((r) => name.test(r.name))!;

describe('runAiTest on a default install', () => {
  it('proves Whisper and the local model each answer, and how long they took', async () => {
    const rows = await runAiTest(NONE, deps());
    expect(row(rows, /Whisper \(local\)/).badge).toBe('ok');
    expect(row(rows, /Whisper \(local\)/).detail).toMatch(/answered in \d/);
    expect(row(rows, /Summary model \(local\)/).badge).toBe('ok');
    expect(row(rows, /Summary model \(local\)/).detail).toContain('qwen3:8b');
  });

  it('fails Whisper with the reason when it does not answer', async () => {
    const rows = await runAiTest(
      NONE,
      deps({
        transcribe: () => async () => {
          throw new Error('connect ECONNREFUSED whisper:8080');
        },
      }),
    );
    expect(row(rows, /Whisper/).badge).toBe('fail');
    expect(row(rows, /Whisper/).detail).toContain('ECONNREFUSED');
  });

  it('fails the local model when it has not been downloaded yet, and says where to look', async () => {
    const rows = await runAiTest(NONE, deps({ hasModel: async () => false }));
    expect(row(rows, /Summary model/).badge).toBe('fail');
    expect(row(rows, /Summary model/).detail).toMatch(/not downloaded/);
    expect(row(rows, /Summary model/).detail).toMatch(/logs worker/);
  });

  it('fails a model that answers with nothing', async () => {
    const rows = await runAiTest(NONE, deps({ generate: () => async () => '   ' }));
    expect(row(rows, /Summary model/).badge).toBe('fail');
    expect(row(rows, /Summary model/).detail).toMatch(/no text/i);
  });

  it('warns, rather than fails, when the model is slow, because a slow model still works', async () => {
    let t = 0;
    const rows = await runAiTest(NONE, deps({ now: () => (t += 70_000), timeoutMs: 1000 }));
    expect(row(rows, /Summary model/).badge).toBe('warn');
    expect(row(rows, /Summary model/).detail).toMatch(/slow/i);
  });

  it('fails a model that never answers, naming how long it waited, instead of hanging', async () => {
    const rows = await runAiTest(
      NONE,
      deps({ generate: () => () => new Promise<string>(() => undefined), timeoutMs: 20 }),
    );
    expect(row(rows, /Summary model/).badge).toBe('fail');
    expect(row(rows, /Summary model/).detail).toMatch(/did not answer/);
  });
});

describe('runAiTest and cloud AI', () => {
  const claude = settings({ kind: 'claude', model: 'claude-sonnet-5-5' });

  it('does not call a configured cloud model without --cloud, tests the local one and says so', async () => {
    const d = deps({ settings: claude });
    const rows = await runAiTest(NONE, d);
    expect(d.calls).not.toContain('generate:cloud');
    expect(d.calls).toContain('generate:local');
    expect(rows.some((r) => r.badge === 'warn' && /--cloud/.test(r.detail))).toBe(true);
  });

  it('calls it exactly once with --cloud, and reports the model and what it used', async () => {
    const d = deps({
      settings: claude,
      env: { ANTHROPIC_API_KEY: 'sk-ant-xxx' },
      generate: (target, onUsage) => async () => {
        d.calls.push(`generate:${target.where}`);
        onUsage({ model: 'claude-sonnet-5-5', inputTokens: 14, outputTokens: 3 });
        return 'ok';
      },
    });
    const rows = await runAiTest({ ...NONE, cloud: true }, d);
    expect(d.calls.filter((c) => c === 'generate:cloud')).toHaveLength(1);
    const r = row(rows, /cloud/i);
    expect(r.badge).toBe('ok');
    expect(r.detail).toContain('claude-sonnet-5-5');
    expect(r.detail).toMatch(/14 in/);
  });

  it('fails --cloud, without calling anything, when the key is not set, and never prints a key', async () => {
    const d = deps({ settings: claude, env: {} });
    const rows = await runAiTest({ ...NONE, cloud: true }, d);
    expect(d.calls).toEqual([]);
    expect(row(rows, /cloud/i).badge).toBe('fail');
    expect(row(rows, /cloud/i).detail).toContain('ANTHROPIC_API_KEY');
  });
});

describe('runAiTest and a remote model', () => {
  const remote = settings({
    kind: 'remote',
    url: 'http://gpu:11434',
    model: 'qwen3:8b',
    context: 8192,
  });

  it('proves it answers, and reports the window it is really serving', async () => {
    const rows = await runAiTest(NONE, deps({ settings: remote }));
    expect(row(rows, /Summary model \(remote\)/).badge).toBe('ok');
    const window = row(rows, /window/i);
    expect(window.badge).toBe('ok');
    expect(window.detail).toMatch(/12288/);
  });

  it('fails when the server serves less than is configured, which would silently truncate', async () => {
    const contextCheck = async (): Promise<OllamaContextStatus> => ({
      kind: 'remote',
      model: 'qwen3:8b',
      unreachable: false,
      checkedAt: 0,
      live: 4096,
    });
    const rows = await runAiTest(NONE, deps({ settings: remote, contextCheck }));
    expect(row(rows, /window/i).badge).toBe('fail');
    expect(row(rows, /window/i).detail).toMatch(/4096/);
  });

  it('does not fail the test when the window could not be read, only says so', async () => {
    const contextCheck = vi.fn(async (): Promise<OllamaContextStatus> => ({
      kind: 'remote',
      model: 'qwen3:8b',
      unreachable: false,
      checkedAt: 0,
    }));
    const rows = await runAiTest(NONE, deps({ settings: remote, contextCheck }));
    expect(row(rows, /window/i).badge).toBe('warn');
  });
});
