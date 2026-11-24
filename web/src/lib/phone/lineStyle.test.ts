import { describe, expect, it } from 'vitest';

import { KIND_CLASS, languageCaption, languageStyle, lineKind, lineText } from './lineStyle.js';

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
  it('has a caption in real text and a font for a language', () => {
    expect(languageCaption('elvish')).toBe('in Elvish');
    expect(languageCaption('klingon')).toBeUndefined();
    expect(languageStyle('elvish')?.fontStyle).toBe('italic');
    expect(languageStyle('dwarvish')?.fontFamily).toMatch(/^"Alegreya SC"/);
    expect(languageStyle('common')).toEqual({});
    expect(languageStyle(undefined)).toBeUndefined();
  });
});
