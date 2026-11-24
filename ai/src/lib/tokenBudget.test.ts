import { describe, expect, it } from 'vitest';
import { contextWindowTokens, estimateTokens } from './tokenBudget.js';

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
  it('ignores a configured context for local too: the worker pins a fixed num_ctx the setting cannot reach', () => {
    expect(contextWindowTokens({ kind: 'local', context: null } as never)).toBe(8192);
    expect(contextWindowTokens({ kind: 'local', context: 40_960 } as never)).toBe(8192);
  });
  it('clamps to the local fallback window when the job can fail over to it, for every backend but local itself', () => {
    expect(contextWindowTokens({ kind: 'claude', context: null } as never, true)).toBe(8192);
    expect(contextWindowTokens({ kind: 'remote', context: 40_960 } as never, true)).toBe(8192);
    // A remote window already smaller than local's own cap is not loosened upward by the clamp.
    expect(contextWindowTokens({ kind: 'remote', context: 4_096 } as never, true)).toBe(4_096);
    // Local is already pinned at its own fixed window; fallback-enabled changes nothing for it.
    expect(contextWindowTokens({ kind: 'local', context: null } as never, true)).toBe(8192);
  });
  it('does not clamp when fallback is not enabled', () => {
    expect(contextWindowTokens({ kind: 'claude', context: null } as never, false)).toBe(100_000);
  });
});
