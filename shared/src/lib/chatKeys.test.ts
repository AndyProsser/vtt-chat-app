import { describe, expect, it } from 'vitest';

import { composerKeyAction, insertNewline, type ComposerKey } from './chatKeys.js';

const k = (o: Partial<ComposerKey> = {}): ComposerKey => ({
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...o,
});

describe('composerKeyAction', () => {
  it('sends on a bare Enter with a keyboard', () => {
    expect(composerKeyAction(k(), false)).toBe('send');
  });
  it('makes Ctrl+Enter and Cmd+Enter a new line, on every device', () => {
    expect(composerKeyAction(k({ ctrlKey: true }), false)).toBe('newline');
    expect(composerKeyAction(k({ metaKey: true }), false)).toBe('newline');
    expect(composerKeyAction(k({ ctrlKey: true }), true)).toBe('newline');
  });
  it('leaves Shift+Enter to the browser, which makes a new line', () => {
    expect(composerKeyAction(k({ shiftKey: true }), false)).toBe('native');
  });
  it('leaves a bare Enter as a new line on a touch device', () => {
    expect(composerKeyAction(k(), true)).toBe('native');
  });
  it('ignores an IME confirmation and other keys', () => {
    expect(composerKeyAction(k({ isComposing: true }), false)).toBe('native');
    expect(composerKeyAction(k({ key: 'a' }), false)).toBe('native');
    expect(composerKeyAction(k({ key: 'Escape', ctrlKey: true }), false)).toBe('native');
  });
});

describe('insertNewline', () => {
  it('breaks the line at the caret and moves the caret after the break', () => {
    expect(insertNewline('hello world', 5, 5)).toEqual({ value: 'hello\n world', caret: 6 });
  });
  it('replaces a selection', () => {
    expect(insertNewline('hello world', 5, 6)).toEqual({ value: 'hello\nworld', caret: 6 });
  });
  it('works at the start and the end', () => {
    expect(insertNewline('ab', 0, 0)).toEqual({ value: '\nab', caret: 1 });
    expect(insertNewline('ab', 2, 2)).toEqual({ value: 'ab\n', caret: 3 });
  });
});
