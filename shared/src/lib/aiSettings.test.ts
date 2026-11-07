import { describe, expect, it } from 'vitest';

import {
  AI_SETTING_KEYS,
  DEFAULT_AI_SETTINGS,
  isAiSettingKey,
  normaliseAiSettings,
  setAiSetting,
  SettingError,
  validateAiSettings,
  type AiSettingKey,
} from './aiSettings.js';

describe('setAiSetting', () => {
  it('changes one key and leaves the input untouched', () => {
    const next = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.transcription.kind', 'remote');
    expect(next.transcription.kind).toBe('remote');
    expect(DEFAULT_AI_SETTINGS.transcription.kind).toBe('local');
  });

  it('keeps only the server root of a URL, without a trailing slash', () => {
    const next = setAiSetting(
      DEFAULT_AI_SETTINGS,
      'ai.transcription.url',
      'http://gaming-pc:8080/',
    );
    expect(next.transcription.url).toBe('http://gaming-pc:8080');
  });

  it('clears a URL or model with "none"', () => {
    const withUrl = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.url', 'https://llm.example.com');
    expect(setAiSetting(withUrl, 'ai.llm.url', 'none').llm.url).toBeNull();
    const withModel = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.model', 'llama3.1:8b');
    expect(withModel.llm.model).toBe('llama3.1:8b');
    expect(setAiSetting(withModel, 'ai.llm.model', 'none').llm.model).toBeNull();
  });

  it.each([
    ['ai.transcription.url', 'not a url'],
    ['ai.transcription.url', 'ftp://host/'],
    ['ai.llm.kind', 'cloud'],
    ['ai.fallback.enabled', 'maybe'],
    ['ai.fallback.after-seconds', '-5'],
    ['ai.fallback.after-seconds', '1.5'],
    ['ai.fallback.retry-seconds', '0'],
    ['ai.transcription.language', 'english please'],
  ] as [AiSettingKey, string][])('rejects %s = %s', (key, value) => {
    expect(() => setAiSetting(DEFAULT_AI_SETTINGS, key, value)).toThrow(SettingError);
  });

  it('accepts a zero fallback delay (switch immediately) and booleans in several spellings', () => {
    expect(
      setAiSetting(DEFAULT_AI_SETTINGS, 'ai.fallback.after-seconds', '0').fallback.afterSeconds,
    ).toBe(0);
    expect(setAiSetting(DEFAULT_AI_SETTINGS, 'ai.fallback.enabled', 'off').fallback.enabled).toBe(
      false,
    );
    expect(setAiSetting(DEFAULT_AI_SETTINGS, 'ai.fallback.enabled', 'YES').fallback.enabled).toBe(
      true,
    );
  });

  it('knows every documented key', () => {
    for (const key of Object.keys(AI_SETTING_KEYS)) {
      expect(isAiSettingKey(key)).toBe(true);
    }
    expect(isAiSettingKey('ai.nonsense')).toBe(false);
  });
});

describe('validateAiSettings', () => {
  it('accepts the defaults', () => {
    expect(validateAiSettings(DEFAULT_AI_SETTINGS)).toEqual([]);
  });

  it('flags a remote backend that has no URL', () => {
    const s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.transcription.kind', 'remote');
    expect(validateAiSettings(s)).toHaveLength(1);
    expect(validateAiSettings(setAiSetting(s, 'ai.transcription.url', 'http://x:1'))).toEqual([]);
  });
});

describe('normaliseAiSettings', () => {
  it('turns nothing, an empty object or junk into the defaults', () => {
    expect(normaliseAiSettings(undefined)).toEqual(DEFAULT_AI_SETTINGS);
    expect(normaliseAiSettings({})).toEqual(DEFAULT_AI_SETTINGS);
    expect(normaliseAiSettings('x')).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('keeps valid stored values and repairs invalid ones field by field', () => {
    const out = normaliseAiSettings({
      transcription: { kind: 'remote', url: 'http://a:1', language: 5 },
      fallback: { enabled: false, afterSeconds: -1, retrySeconds: 7 },
      bogus: true,
    });
    expect(out.transcription).toMatchObject({ kind: 'remote', url: 'http://a:1', language: 'en' });
    expect(out.fallback).toEqual({ enabled: false, afterSeconds: 600, retrySeconds: 7 });
  });
});
