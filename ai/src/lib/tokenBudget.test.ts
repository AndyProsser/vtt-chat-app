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
  it('uses the operator value for local/remote, or the 8,192 default when unset', () => {
    expect(contextWindowTokens({ kind: 'local', context: null } as never)).toBe(8192);
    expect(contextWindowTokens({ kind: 'remote', context: 40_960 } as never)).toBe(40_960);
  });
  it('ignores a configured context for claude/openai and uses the cloud default', () => {
    expect(contextWindowTokens({ kind: 'claude', context: 8192 } as never)).toBe(100_000);
    expect(contextWindowTokens({ kind: 'openai', context: null } as never)).toBe(100_000);
  });
});
