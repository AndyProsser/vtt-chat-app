// @vitest-environment jsdom
import { act } from 'react';
import Markdown from 'react-markdown';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { langUrlTransform } from '../lib/langSpan.js';
import { DEFAULT_READING_PREFS, useReadingPrefsStore } from '../lib/readingPrefs.js';
import { makeLangComponents } from './langMarkdown.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const components = makeLangComponents('inert');
let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  useReadingPrefsStore.setState({ ...DEFAULT_READING_PREFS });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

const render = (text: string): string => {
  act(() =>
    root.render(
      <Markdown skipHtml urlTransform={langUrlTransform} components={components}>
        {text}
      </Markdown>,
    ),
  );
  return host.innerHTML;
};

describe('language spans in Markdown', () => {
  it('sets an inline lang: link in its language’s font, as text, not a link', () => {
    const html = render('The door reads [Khazad ul barak](lang:dwarvish), a warning.');
    expect(html).toContain('Khazad ul barak');
    expect(html).toContain('data-lang="dwarvish"');
    expect(html).toContain('Alegreya SC');
    expect(html).toContain('title="Dwarvish"');
    expect(html).not.toContain('<a');
  });

  it('leaves an ordinary link as inert text, with no address', () => {
    const html = render('See [the map](https://example.com/map).');
    expect(html).toContain('<span class="inert">the map</span>');
    expect(html).not.toContain('href');
  });

  it('keeps an unsafe or unknown link inert', () => {
    expect(render('[x](javascript:alert(1))')).toContain('<span class="inert">x</span>');
    expect(render('[x](lang:klingon)')).toContain('<span class="inert">x</span>');
    expect(render('[x](lang:common)')).toContain('<span class="inert">x</span>');
  });

  it('sets a fenced block named for a language as a block in that font', () => {
    const html = render('```elvish\nNamárië\nAlassë\n```');
    expect(html).toContain('ui-lang-block');
    expect(html).toContain('data-lang="elvish"');
    expect(html).toContain('Cormorant Garamond');
    expect(html).toContain('Namárië');
    expect(html).toContain('Alassë');
    expect(html).not.toContain('<pre');
  });

  it('leaves ordinary code blocks as code', () => {
    const html = render('```ts\nconst a = 1;\n```');
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).not.toContain('ui-lang');
  });

  it('shows the words, plain, in force readable mode, and keeps the language name', () => {
    useReadingPrefsStore.setState({ forceReadable: true });
    const html = render('[Khazad ul barak](lang:dwarvish)');
    expect(html).toContain('Khazad ul barak');
    expect(html).toContain('title="Dwarvish"');
    expect(html).not.toContain('Alegreya SC');
  });

  it('shows the words, plain, with language fonts switched off', () => {
    useReadingPrefsStore.setState({ languageFonts: false });
    expect(render('[Khazad ul barak](lang:dwarvish)')).not.toContain('Alegreya SC');
  });
});

describe('a viewer that does not know the syntax', () => {
  it('still shows every word', () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {'The door reads [Khazad ul barak](lang:dwarvish).\n\n```dwarvish\nKhazad ul durin\n```'}
      </Markdown>,
    );
    expect(html).toContain('Khazad ul barak');
    expect(html).toContain('Khazad ul durin');
  });
});
