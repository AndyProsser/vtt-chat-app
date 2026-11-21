import { describe, expect, it } from 'vitest';

import { DEFAULT_AI_SETTINGS, setAiSetting } from './aiSettings.js';
import { isOwnNetworkHost, processingLocation } from './processingNotice.js';

describe('isOwnNetworkHost', () => {
  it('accepts private, loopback and link-local addresses', () => {
    for (const h of [
      '10.1.2.3',
      '127.0.0.1',
      '172.16.0.9',
      '172.31.255.1',
      '192.168.1.50',
      '169.254.1.1',
      '::1',
      '[fd12:3456::1]',
      'fe80::1',
    ])
      expect(isOwnNetworkHost(h), h).toBe(true);
  });
  it('accepts single-label names and the home suffixes', () => {
    for (const h of [
      'gaming-pc',
      'localhost',
      'box.local',
      'nas.lan',
      'x.internal',
      'pc.home.arpa',
    ])
      expect(isOwnNetworkHost(h), h).toBe(true);
  });
  it('refuses public addresses and ordinary domains', () => {
    for (const h of [
      '8.8.8.8',
      '172.32.0.1',
      '172.15.0.1',
      '11.0.0.1',
      'api.openai.com',
      'example.com',
      '2001:db8::1',
      '',
    ])
      expect(isOwnNetworkHost(h), h).toBe(false);
  });
});

describe('processingLocation', () => {
  const remote = (url: string) => ({ kind: 'remote' as const, url, model: null });
  it('is local by default and with a remote on the own network', () => {
    expect(processingLocation(DEFAULT_AI_SETTINGS)).toBe('local');
    expect(
      processingLocation({ ...DEFAULT_AI_SETTINGS, llm: remote('http://gaming-pc:11434') }),
    ).toBe('local');
  });
  it('is offsite when either remote is somewhere else', () => {
    expect(
      processingLocation({ ...DEFAULT_AI_SETTINGS, llm: remote('https://api.example.com') }),
    ).toBe('offsite');
    expect(
      processingLocation({
        ...DEFAULT_AI_SETTINGS,
        transcription: { ...remote('https://whisper.example.com'), language: 'en' },
      }),
    ).toBe('offsite');
  });
  it('treats a remote with no readable address as offsite, and a remote with no url as local', () => {
    expect(processingLocation({ ...DEFAULT_AI_SETTINGS, llm: remote('not a url') })).toBe(
      'offsite',
    );
    expect(
      processingLocation({
        ...DEFAULT_AI_SETTINGS,
        llm: { kind: 'remote', url: null, model: null },
      }),
    ).toBe('local');
  });

  it('is offsite whenever the LLM is Claude, whatever else is configured', () => {
    const s = setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'claude');
    expect(processingLocation(s)).toBe('offsite');
  });
});
