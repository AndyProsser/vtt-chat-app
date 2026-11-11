import { CHAT_LANGUAGES } from '@vtt-chat-app/shared';
import { describe, expect, it } from 'vitest';

import {
  KIND_CLASS,
  LANGUAGE_STYLES,
  languageCaption,
  languageStyle,
  lineKind,
  lineText,
} from './lineStyle.js';

describe('line style', () => {
  it('styles a whisper as itself and defaults the kind', () => {
    expect(lineKind({ kind: 'say', toId: 'x' })).toBe('whisper');
    expect(lineKind({ kind: 'ooc', toId: null })).toBe('ooc');
    expect(KIND_CLASS.ooc).toBe('phone-line-ooc');
  });
  it('quotes say lines, writes do lines as stage directions, leaves the rest', () => {
    expect(lineText({ kind: 'say', text: 'Hi', fromName: 'A' })).toBe('“Hi”');
    expect(lineText({ kind: 'do', text: 'waves', fromName: 'Thorin' })).toBe('* Thorin waves');
    expect(lineText({ kind: 'ooc', text: 'brb', fromName: 'A' })).toBe('brb');
  });
  it('has a preset for every language style and a caption in real text', () => {
    for (const l of CHAT_LANGUAGES) expect(LANGUAGE_STYLES[l.style]).toBeDefined();
    expect(languageCaption('elvish')).toBe('in Elvish');
    expect(languageCaption('klingon')).toBeUndefined();
    expect(languageStyle('elvish')?.fontStyle).toBe('italic');
    expect(languageStyle('common')).toEqual({});
    expect(languageStyle(undefined)).toBeUndefined();
  });
});
