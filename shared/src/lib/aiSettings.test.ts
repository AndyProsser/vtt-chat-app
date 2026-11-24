import { describe, expect, it } from 'vitest';

import { effectiveBard, offeredBards } from '../consts/bards.js';
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

  it('accepts claude as the LLM kind only (not for transcription), and keeps it when read back', () => {
    const next = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'claude');
    expect(next.llm.kind).toBe('claude');
    expect(validateAiSettings(next)).toEqual([]);
    expect(normaliseAiSettings(JSON.parse(JSON.stringify(next))).llm.kind).toBe('claude');
    expect(() => setAiSetting(DEFAULT_AI_SETTINGS, 'ai.transcription.kind', 'claude')).toThrow(
      SettingError,
    );
  });

  it('accepts openai with a model, prices in dollars, and needs the model named', () => {
    let s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'openai');
    expect(validateAiSettings(s).join()).toMatch(/no model is named/);
    s = setAiSetting(s, 'ai.llm.model', 'm');
    s = setAiSetting(s, 'ai.llm.price-in', '0.4');
    s = setAiSetting(s, 'ai.llm.price-out', '1.6');
    expect(validateAiSettings(s)).toEqual([]);
    const back = normaliseAiSettings(JSON.parse(JSON.stringify(s)));
    expect(back.llm).toMatchObject({ kind: 'openai', priceIn: 0.4, priceOut: 1.6 });
    expect(setAiSetting(s, 'ai.llm.price-in', 'none').llm.priceIn).toBeNull();
    expect(() => setAiSetting(s, 'ai.llm.price-in', '-1')).toThrow(SettingError);
    expect(() => setAiSetting(s, 'ai.llm.price-in', 'cheap')).toThrow(SettingError);
  });

  it('sets and clears ai.llm.context', () => {
    let s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.context', '40960');
    expect(s.llm.context).toBe(40960);
    s = setAiSetting(s, 'ai.llm.context', 'none');
    expect(s.llm.context).toBeNull();
  });

  it('rejects a non-numeric or negative ai.llm.context', () => {
    expect(() => setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.context', '-1')).toThrow(SettingError);
    expect(() => setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.context', 'lots')).toThrow(SettingError);
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

describe('the tale settings', () => {
  it('start at default length, default content and every storyteller offered', () => {
    expect(DEFAULT_AI_SETTINGS.tale).toEqual({
      length: 'default',
      content: 'default',
      storytellersOff: [],
    });
  });

  it('take the three lengths and the three content levels, and refuse anything else', () => {
    let s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.tale.length', 'short');
    s = setAiSetting(s, 'ai.tale.content', 'Clean');
    expect(s.tale).toMatchObject({ length: 'short', content: 'clean' });
    expect(() => setAiSetting(s, 'ai.tale.length', 'huge')).toThrow(SettingError);
    expect(() => setAiSetting(s, 'ai.tale.content', 'rude')).toThrow(SettingError);
  });

  it('turn a storyteller off and on again, but never the Tavern Bard', () => {
    let s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.storyteller.drunken', 'off');
    s = setAiSetting(s, 'ai.storyteller.dry', 'off');
    expect(s.tale.storytellersOff).toEqual(['drunken', 'dry']);
    expect(offeredBards(s.tale.storytellersOff)).toEqual(['tavern', 'sarcastic', 'bored']);
    s = setAiSetting(s, 'ai.storyteller.drunken', 'on');
    expect(s.tale.storytellersOff).toEqual(['dry']);
    expect(() => setAiSetting(s, 'ai.storyteller.tavern', 'off')).toThrow(/cannot be turned off/);
    expect(setAiSetting(s, 'ai.storyteller.tavern', 'on').tale.storytellersOff).toEqual(['dry']);
  });

  it("fall back to the Tavern Bard when the campaign's storyteller is off", () => {
    expect(effectiveBard('drunken', ['drunken'])).toBe('tavern');
    expect(effectiveBard('drunken', [])).toBe('drunken');
    expect(effectiveBard('tavern', ['tavern' as never])).toBe('tavern');
  });

  it('repair stored junk, and never keep the Tavern Bard off', () => {
    const out = normaliseAiSettings({
      tale: { length: 'giant', content: 'graphic', storytellersOff: ['tavern', 'bored', 'nope'] },
    });
    expect(out.tale).toEqual({ length: 'default', content: 'graphic', storytellersOff: ['bored'] });
  });

  it('pause local processing while a table records: off by default, settable, repaired when junk', () => {
    expect(DEFAULT_AI_SETTINGS.processing.pauseWhileRecording).toBe(false);
    const on = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.pause-while-recording', 'true');
    expect(on.processing.pauseWhileRecording).toBe(true);
    expect(() => setAiSetting(on, 'ai.pause-while-recording', 'sometimes')).toThrow(SettingError);
    expect(normaliseAiSettings({}).processing.pauseWhileRecording).toBe(false);
    expect(
      normaliseAiSettings({ processing: { pauseWhileRecording: 'yes' } }).processing
        .pauseWhileRecording,
    ).toBe(false);
  });
});
