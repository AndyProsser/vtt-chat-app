import { DEFAULT_AI_SETTINGS, type AiSettings } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import { aiTargets } from './aiTargets.js';

const settings = (
  llm: Partial<AiSettings['llm']> = {},
  transcription: Partial<AiSettings['transcription']> = {},
): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  llm: { ...DEFAULT_AI_SETTINGS.llm, ...llm },
  transcription: { ...DEFAULT_AI_SETTINGS.transcription, ...transcription },
});
const NONE = { local: false, remote: false, cloud: false };

describe('aiTargets: with no flags, what is configured', () => {
  it('tests the local Whisper and the local model on a default install', () => {
    expect(aiTargets(settings(), NONE)).toEqual({
      targets: [
        { what: 'transcription', where: 'local' },
        { what: 'llm', where: 'local' },
      ],
      notes: [],
    });
  });

  it('tests a configured remote Whisper and remote model', () => {
    const r = aiTargets(
      settings(
        { kind: 'remote', url: 'http://gpu:11434', model: 'qwen3:8b' },
        { kind: 'remote', url: 'http://gpu:8080', model: 'large-v3' },
      ),
      NONE,
    );
    expect(r.targets).toEqual([
      { what: 'transcription', where: 'remote' },
      { what: 'llm', where: 'remote' },
    ]);
  });

  it('never calls cloud AI without the flag: it tests the local model and says so', () => {
    const r = aiTargets(settings({ kind: 'claude', model: 'claude-sonnet-5-5' }), NONE);
    expect(r.targets).toEqual([
      { what: 'transcription', where: 'local' },
      { what: 'llm', where: 'local' },
    ]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ badge: 'warn' });
    expect(r.notes[0]?.detail).toMatch(/--cloud/);
    expect(r.notes[0]?.detail).toMatch(/billable|cost/i);
    expect(r.notes[0]?.detail).toMatch(/local/i);
  });
});

describe('aiTargets: with flags, exactly what was asked for', () => {
  it('--local tests the local backends whatever is configured', () => {
    const r = aiTargets(settings({ kind: 'claude' }), { ...NONE, local: true });
    expect(r.targets).toEqual([
      { what: 'transcription', where: 'local' },
      { what: 'llm', where: 'local' },
    ]);
    expect(r.notes).toEqual([]);
  });

  it('--remote tests only the remote parts that are configured', () => {
    const r = aiTargets(settings({ kind: 'remote', url: 'http://gpu:11434', model: 'q' }), {
      ...NONE,
      remote: true,
    });
    expect(r.targets).toEqual([{ what: 'llm', where: 'remote' }]);
  });

  it('--remote says so when nothing remote is configured', () => {
    const r = aiTargets(settings(), { ...NONE, remote: true });
    expect(r.targets).toEqual([]);
    expect(r.notes[0]?.detail).toMatch(/nothing remote is configured/i);
  });

  it('--cloud tests the configured cloud model', () => {
    const r = aiTargets(settings({ kind: 'claude', model: 'claude-sonnet-5-5' }), {
      ...NONE,
      cloud: true,
    });
    expect(r.targets).toEqual([{ what: 'llm', where: 'cloud' }]);
    expect(r.notes).toEqual([]);
  });

  it('--cloud says so when no cloud AI is configured, and calls nothing', () => {
    const r = aiTargets(settings(), { ...NONE, cloud: true });
    expect(r.targets).toEqual([]);
    expect(r.notes[0]?.detail).toMatch(/no cloud AI is configured/i);
  });

  it('flags combine, and nothing is tested twice', () => {
    const r = aiTargets(settings({ kind: 'remote', url: 'http://gpu:11434', model: 'q' }), {
      local: true,
      remote: true,
      cloud: false,
    });
    expect(r.targets).toEqual([
      { what: 'transcription', where: 'local' },
      { what: 'llm', where: 'local' },
      { what: 'llm', where: 'remote' },
    ]);
  });
});
