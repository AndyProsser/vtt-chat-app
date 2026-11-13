import { CHAT_LANGUAGES } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import { applyEvent, emptyTable } from './tableModel.js';
import { LANGUAGE_STYLES, kindOf, languageOf, languageStyle } from './chatStyle.js';

describe('chat style', () => {
  it('defaults a missing or unknown kind to chat', () => {
    expect(kindOf(undefined)).toBe('chat');
    expect(kindOf('shout')).toBe('chat');
    expect(kindOf('ooc')).toBe('ooc');
  });
  it('has a preset for every style a language uses', () => {
    for (const l of CHAT_LANGUAGES) expect(LANGUAGE_STYLES[l.style]).toBeDefined();
  });
  it('maps a language to its preset', () => {
    expect(languageStyle('elvish')?.fontStyle).toBe('italic');
    expect(languageStyle('dwarvish')?.fontFamily).toMatch(/^"Alfa Slab One"/);
    expect(languageStyle('common')).toEqual({});
    expect(languageStyle('klingon')).toBeUndefined();
    expect(languageOf('deep-speech')?.name).toBe('Deep Speech');
  });
});

describe('chat store lines', () => {
  const line = (extra: object) => ({
    t: 'chat.message',
    d: { id: 'a', from: { userId: 'u', name: 'U' }, text: 'hi', at: 1, ...extra },
  });
  it('carries kind and lang', () => {
    const s = applyEvent(emptyTable, line({ kind: 'say', lang: 'elvish' }));
    expect(s.chat[0]).toMatchObject({ kind: 'say', lang: 'elvish' });
  });
  it('treats a missing kind as chat and has no lang', () => {
    const s = applyEvent(emptyTable, line({}));
    expect(s.chat[0]?.kind).toBe('chat');
    expect(s.chat[0]).not.toHaveProperty('lang');
  });
  it('carries kind from a snapshot', () => {
    const s = applyEvent(emptyTable, {
      t: 'snapshot',
      d: {
        members: [],
        recentChat: [{ id: 'a', from: { userId: 'u', name: 'U' }, text: 'x', at: 1, kind: 'ooc' }],
      },
    });
    expect(s.chat[0]?.kind).toBe('ooc');
  });
});
