import { DEFAULT_AI_SETTINGS, type AiSettings } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import { describeJobModels } from './jobModels.js';

const LOCAL = { llm: 'qwen3:8b', story: 'gemma3:12b' };
const settings = (over: {
  llm?: Partial<AiSettings['llm']>;
  transcription?: Partial<AiSettings['transcription']>;
}): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  llm: { ...DEFAULT_AI_SETTINGS.llm, ...over.llm },
  transcription: { ...DEFAULT_AI_SETTINGS.transcription, ...over.transcription },
});

describe('describeJobModels', () => {
  it('names the local models, the scribe and the bard separately when they differ', () => {
    expect(describeJobModels(settings({}), LOCAL)).toEqual({
      transcription: 'Whisper (local)',
      scribe: 'qwen3:8b (local)',
      bard: 'gemma3:12b (local)',
    });
  });

  it('names one local model for both roles when there is only one', () => {
    const m = describeJobModels(settings({}), { llm: 'qwen3:8b' });
    expect(m.scribe).toBe('qwen3:8b (local)');
    expect(m.bard).toBe('qwen3:8b (local)');
  });

  it('names a remote model for both roles, and a remote Whisper', () => {
    const m = describeJobModels(
      settings({
        llm: { kind: 'remote', url: 'http://gpu:11434', model: 'qwen3:8b' },
        transcription: { kind: 'remote', url: 'http://gpu:8080', model: 'large-v3-turbo' },
      }),
      LOCAL,
    );
    expect(m).toEqual({
      transcription: 'large-v3-turbo (remote)',
      scribe: 'qwen3:8b (remote)',
      bard: 'qwen3:8b (remote)',
    });
  });

  it('names Claude and OpenAI by their model', () => {
    expect(
      describeJobModels(settings({ llm: { kind: 'claude', model: 'claude-sonnet-5-5' } }), LOCAL)
        .bard,
    ).toBe('claude-sonnet-5-5');
    expect(
      describeJobModels(settings({ llm: { kind: 'claude', model: null } }), LOCAL).scribe,
    ).toBe('claude-sonnet-5-5');
    expect(
      describeJobModels(settings({ llm: { kind: 'openai', model: 'gpt-5' } }), LOCAL).scribe,
    ).toBe('gpt-5');
  });

  it('says the local model did the work, and that it fell back, when the remote was unreachable', () => {
    const m = describeJobModels(
      settings({ llm: { kind: 'remote', url: 'http://gpu:11434', model: 'qwen3:8b' } }),
      LOCAL,
      ['llm'],
    );
    expect(m.scribe).toBe('qwen3:8b (local)');
    expect(m.bard).toBe('gemma3:12b (local)');
    expect(m.fellBack).toEqual(['llm']);
  });

  it('says a remote Whisper fell back to the local one', () => {
    const m = describeJobModels(
      settings({
        transcription: { kind: 'remote', url: 'http://gpu:8080', model: 'large-v3-turbo' },
      }),
      LOCAL,
      ['transcription'],
    );
    expect(m.transcription).toBe('Whisper (local)');
    expect(m.fellBack).toEqual(['transcription']);
  });

  it('has no fell-back note when nothing fell back', () => {
    expect(describeJobModels(settings({}), LOCAL, [])).not.toHaveProperty('fellBack');
  });
});
