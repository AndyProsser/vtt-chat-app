import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarkdownView } from './MarkdownView.js';

const render = (text: string) => renderToStaticMarkup(<MarkdownView text={text} />);

describe('MarkdownView (desktop)', () => {
  it('sets a lang: link in its language’s font', () => {
    const html = render('It reads [Khazad ul barak](lang:dwarvish).');
    expect(html).toContain('data-lang="dwarvish"');
    expect(html).toContain('Alegreya SC');
    expect(html).toContain('Khazad ul barak');
    expect(html).not.toContain('<a');
  });

  it('sets a fenced block named for a language in its font', () => {
    const html = render('```elvish\nNamárië\n```');
    expect(html).toContain('ui-lang-block');
    expect(html).toContain('Namárië');
  });

  it('still shows an ordinary link as inert text and drops pictures', () => {
    const html = render('See [the map](https://example.com) ![x](https://example.com/x.png)');
    expect(html).toContain('<span class="vtt-md-link">the map</span>');
    expect(html).not.toContain('href');
    expect(html).not.toContain('<img');
  });

  it('leaves ordinary code alone', () => {
    expect(render('```ts\nlet a = 1\n```')).toContain('<pre><code class="language-ts">');
  });
});
