import { describe, expect, it } from 'vitest';

import { applyFormat } from './markdownFormat.js';

const run = (text: string, start: number, end: number, kind: Parameters<typeof applyFormat>[3]) =>
  applyFormat(text, start, end, kind);

describe('applyFormat', () => {
  it('wraps the selection in bold or italic markers, keeping it selected', () => {
    expect(run('a big dog', 2, 5, 'bold')).toEqual({ text: 'a **big** dog', start: 4, end: 7 });
    expect(run('a big dog', 2, 5, 'italic')).toEqual({ text: 'a *big* dog', start: 3, end: 6 });
  });

  it('removes the markers again when the selection is already wrapped', () => {
    expect(run('a **big** dog', 4, 7, 'bold')).toEqual({ text: 'a big dog', start: 2, end: 5 });
  });

  it('with nothing selected, inserts a placeholder to type over', () => {
    const r = run('hi ', 3, 3, 'bold');
    expect(r.text).toBe('hi **text**');
    expect(r.text.slice(r.start, r.end)).toBe('text');
  });

  it('turns every selected line into a list item or a quote, and back', () => {
    expect(run('one\ntwo', 0, 7, 'list')).toMatchObject({ text: '- one\n- two' });
    expect(run('- one\n- two', 0, 11, 'list')).toMatchObject({ text: 'one\ntwo' });
    expect(run('one', 0, 3, 'quote')).toMatchObject({ text: '> one' });
  });

  it('makes the line a heading, and a second press removes it', () => {
    expect(run('Crypt', 2, 2, 'heading')).toMatchObject({ text: '## Crypt' });
    expect(run('## Crypt', 4, 4, 'heading')).toMatchObject({ text: 'Crypt' });
  });

  it('only touches the lines the selection reaches', () => {
    expect(run('a\nb\nc', 2, 3, 'list')).toMatchObject({ text: 'a\n- b\nc' });
  });

  it('adds a divider on its own lines', () => {
    expect(run('above', 5, 5, 'rule').text).toBe('above\n\n---\n\n');
  });
});
