import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MarkdownView from '../../components/phone/MarkdownView.js';
import { previewOf } from './markdownPreview.js';

const html = (text: string) => renderToStaticMarkup(createElement(MarkdownView, { text }));

describe('previewOf', () => {
  it('is empty for nothing or whitespace, else the text as typed', () => {
    expect(previewOf('')).toEqual({ kind: 'empty' });
    expect(previewOf(' \n\t')).toEqual({ kind: 'empty' });
    expect(previewOf('**hi**')).toEqual({ kind: 'text', text: '**hi**' });
  });
});

describe('the markdown renderer both the viewer and the preview use', () => {
  it('formats headings, emphasis, lists and quotes', () => {
    const out = html('# Title\n\n**bold** and *italic*\n\n- one\n- two\n\n> read aloud');
    expect(out).toContain('<h1>Title</h1>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<blockquote>');
  });
  it('drops raw HTML, so a note can never inject markup', () => {
    const out = html(
      'hi <script>alert(1)</script> <img src=x onerror=alert(1)> <b onclick=x>b</b>',
    );
    expect(out).not.toMatch(/<script|<img|onerror|onclick|<b[ >]/);
    expect(out).toContain('hi');
  });
  it('never loads a picture or follows a link: both are shown as text', () => {
    const out = html(
      '![pic](https://evil.example/p.png) [click](javascript:alert(1)) [site](https://example.com)',
    );
    expect(out).not.toMatch(/<img|<a[ >]|href=|src=/);
    expect(out).toContain('click');
    expect(out).toContain('site');
  });
});
