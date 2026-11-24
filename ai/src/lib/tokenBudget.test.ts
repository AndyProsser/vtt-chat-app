import { describe, expect, it } from 'vitest';
import { contextWindowTokens, estimateTokens, ollamaNumCtx } from './tokenBudget.js';

describe('estimateTokens', () => {
  it('is about one token per 3.5 characters, rounded up', () => {
    expect(estimateTokens('a'.repeat(35))).toBe(10);
    expect(estimateTokens('a'.repeat(36))).toBe(11);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('contextWindowTokens', () => {
  it('uses the operator value for remote, or the 8,192 default when unset', () => {
    expect(contextWindowTokens({ kind: 'remote', context: null } as never)).toBe(8192);
    expect(contextWindowTokens({ kind: 'remote', context: 40_960 } as never)).toBe(40_960);
  });
  it('ignores a configured context for claude/openai and uses the cloud default', () => {
    expect(contextWindowTokens({ kind: 'claude', context: 8192 } as never)).toBe(100_000);
    expect(contextWindowTokens({ kind: 'openai', context: null } as never)).toBe(100_000);
  });
  it('uses the operator value for local too, now that the worker sends it as num_ctx on every call', () => {
    expect(contextWindowTokens({ kind: 'local', context: null } as never)).toBe(8192);
    expect(contextWindowTokens({ kind: 'local', context: 40_960 } as never)).toBe(40_960);
  });
  it('clamps to the local fallback window when the job can fail over to it, for every backend but local itself', () => {
    expect(contextWindowTokens({ kind: 'claude', context: null } as never, true)).toBe(8192);
    expect(contextWindowTokens({ kind: 'remote', context: 40_960 } as never, true)).toBe(8192);
    // A remote window already smaller than local's own cap is not loosened upward by the clamp.
    expect(contextWindowTokens({ kind: 'remote', context: 4_096 } as never, true)).toBe(4_096);
    // Local is already the fallback target: the clamp never applies to it, even configured above the
    // measured default — there is nothing further for it to "fail over" to.
    expect(contextWindowTokens({ kind: 'local', context: null } as never, true)).toBe(8192);
    expect(contextWindowTokens({ kind: 'local', context: 40_960 } as never, true)).toBe(40_960);
  });
  it('does not clamp when fallback is not enabled', () => {
    expect(contextWindowTokens({ kind: 'claude', context: null } as never, false)).toBe(100_000);
  });
  it("uses a known Claude model's real context window instead of the flat cloud default", () => {
    expect(contextWindowTokens({ kind: 'claude', model: 'claude-opus-5-5' } as never)).toBe(
      1_000_000,
    );
  });
  it('falls back to the flat cloud default for a Claude model not in the table, or none named', () => {
    expect(contextWindowTokens({ kind: 'claude', model: 'claude-not-a-real-model' } as never)).toBe(
      100_000,
    );
    expect(contextWindowTokens({ kind: 'claude', model: null } as never)).toBe(100_000);
  });
});

describe('ollamaNumCtx', () => {
  it("uses the operator's configured value for local, or the measured default when unset", () => {
    expect(ollamaNumCtx({ kind: 'local', context: null } as never)).toBe(8192);
    expect(ollamaNumCtx({ kind: 'local', context: 40_960 } as never)).toBe(40_960);
  });
  it('always uses the measured default for a call that lands on local by failover, whatever the configured kind is', () => {
    // A job configured for remote/claude/openai can fail over to the local Ollama mid-job; that call must
    // still carry a sane num_ctx (never `undefined` — Ollama's own default is uncontrolled and may be
    // smaller than what the job was sized for) and never the *configured* kind's own `context`, which
    // means nothing once the call has actually landed on local.
    expect(ollamaNumCtx({ kind: 'remote', context: 40_960 } as never)).toBe(8192);
    expect(ollamaNumCtx({ kind: 'claude', context: null } as never)).toBe(8192);
    expect(ollamaNumCtx({ kind: 'openai', context: null } as never)).toBe(8192);
  });
});
