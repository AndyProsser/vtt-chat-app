/** The model the Claude connector uses when the operator names none (Andy, 2026-11-17: Sonnet, "more than affordable"). */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';

/**
 * What Claude costs, US dollars per million tokens (input, output). **Dated, and an estimate:** Anthropic's list prices
 * as of 2026-11-03, used only to show a job's cost in `vtt-admin jobs list`; the Anthropic console is the bill.
 */
export const CLAUDE_PRICES_DATE = '2026-11-03';
export const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

/** What one job used of Claude (all calls, all attempts, summed). */
export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Dollars, summed, when the operator gave prices (`ai.llm.price-in`/`price-out`); absent otherwise. */
  costUsd?: number;
}

/** Dollars for a usage: the operator's own prices when they gave them, else the built-in Claude table; or `undefined` for a model not in the price table. */
export function estimateClaudeCost(usage: LlmUsage): number | undefined {
  if (usage.costUsd !== undefined) return usage.costUsd;
  const price = CLAUDE_PRICES[usage.model];
  if (!price) return undefined;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
