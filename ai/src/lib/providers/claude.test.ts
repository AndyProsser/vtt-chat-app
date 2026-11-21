import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { estimateClaudeCost } from '../../consts/index.js';
import { createClaudeGenerate } from './claude.js';
import { ProviderUnavailableError } from './errors.js';

const reply = (over: Record<string, unknown> = {}) => ({
  content: [{ type: 'text', text: 'the notes' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1200, output_tokens: 300 },
  ...over,
});
const fake = (create: (body: Record<string, unknown>) => unknown) =>
  ({ messages: { create: vi.fn(async (body: Record<string, unknown>) => create(body)) } }) as never;
const status = (code: number) =>
  new Anthropic.APIError(code, { error: { message: 'x' } }, 'x', new Headers());

describe('createClaudeGenerate', () => {
  it('sends the prompt with low effort and no sampling settings, and returns the text', async () => {
    const onUsage = vi.fn();
    const client = fake(() => reply());
    const generate = createClaudeGenerate({ apiKey: 'k', client, onUsage });
    expect(await generate('write notes')).toBe('the notes');
    const body = (client as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages).toEqual([{ role: 'user', content: 'write notes' }]);
    expect(onUsage).toHaveBeenCalledWith({
      model: 'claude-sonnet-5-5',
      inputTokens: 1200,
      outputTokens: 300,
    });
  });

  it('uses the model the operator chose', async () => {
    const client = fake(() => reply());
    await createClaudeGenerate({ apiKey: 'k', model: 'claude-haiku-5-5', client })('p');
    expect(
      (client as { messages: { create: ReturnType<typeof vi.fn> } }).messages.create.mock
        .calls[0]![0].model,
    ).toBe('claude-haiku-5-5');
  });

  it('treats a refusal as unavailable (so the job can finish locally), still counting its tokens', async () => {
    const onUsage = vi.fn();
    const generate = createClaudeGenerate({
      apiKey: 'k',
      onUsage,
      client: fake(() =>
        reply({ content: [], stop_reason: 'refusal', stop_details: { category: 'general_harms' } }),
      ),
    });
    await expect(generate('p')).rejects.toThrow(ProviderUnavailableError);
    await expect(generate('p')).rejects.toThrow(/general_harms/);
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it('treats overload and rate limits as unavailable, and a bad key as a plain error', async () => {
    for (const code of [429, 500, 529]) {
      const generate = createClaudeGenerate({
        apiKey: 'k',
        client: fake(() => {
          throw status(code);
        }),
      });
      await expect(generate('p')).rejects.toThrow(ProviderUnavailableError);
    }
    const bad = createClaudeGenerate({
      apiKey: 'k',
      client: fake(() => {
        throw status(401);
      }),
    });
    const error = await bad('p').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ProviderUnavailableError);
  });

  it('fails clearly when the reply holds no text', async () => {
    const generate = createClaudeGenerate({
      apiKey: 'k',
      client: fake(() => reply({ content: [], stop_reason: 'max_tokens' })),
    });
    await expect(generate('p')).rejects.toThrow(/ran out of output tokens/);
  });
});

describe('estimateClaudeCost', () => {
  it('prices a usage from the table, and says nothing for an unknown model', () => {
    expect(
      estimateClaudeCost({
        model: 'claude-sonnet-5-5',
        inputTokens: 110_000,
        outputTokens: 10_000,
        calls: 8,
      }),
    ).toBeCloseTo(0.32);
    expect(
      estimateClaudeCost({ model: 'mystery', inputTokens: 1, outputTokens: 1, calls: 1 }),
    ).toBeUndefined();
  });
});
