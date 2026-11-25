import { CHAT_LANGUAGES } from '@vtt-chat-app/shared';
import { isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';

import { useLanguageSwitches } from '../hooks/useLanguageSwitches.js';
import { langFromFence, parseLangHref } from '../lib/langSpan.js';
import { languageTextStyle } from '../lib/languageTextStyle.js';

const nameOf = (lang: string): string => CHAT_LANGUAGES.find((l) => l.key === lang)?.name ?? lang;

/** A few words in an in-world language, set in that language's font (the reading switches decide whether). */
export function LangSpan({ lang, children }: { lang: string; children?: ReactNode }) {
  const switches = useLanguageSwitches();
  return (
    <span
      className="ui-lang"
      data-lang={lang}
      title={nameOf(lang)}
      style={languageTextStyle(lang, switches)}
    >
      {children}
    </span>
  );
}

/** A whole inscription or verse in an in-world language: the same, as a block that keeps its line breaks. */
export function LangBlock({ lang, children }: { lang: string; children?: ReactNode }) {
  const switches = useLanguageSwitches();
  return (
    <div
      className="ui-lang-block"
      data-lang={lang}
      title={nameOf(lang)}
      style={languageTextStyle(lang, switches)}
    >
      {children}
    </div>
  );
}

/**
 * The two react-markdown `components` that give a handout, note or tale its language spans
 * (docs/architecture/RPG-MARKDOWN-EXTENSION.md): a `lang:` link and a fenced block named for a language. Every other link
 * stays inert text (`inertLinkClass`), so a handout can format but never reach out, and every other code block is untouched.
 * Pair with `urlTransform={langUrlTransform}`.
 */
export function makeLangComponents(inertLinkClass: string): Components {
  return {
    a: ({ href, children }) => {
      const lang = parseLangHref(href);
      return lang ? (
        <LangSpan lang={lang}>{children}</LangSpan>
      ) : (
        <span className={inertLinkClass}>{children}</span>
      );
    },
    pre: ({ children }) => {
      const code = isValidElement(children)
        ? (children as { props: { className?: string; children?: ReactNode } })
        : undefined;
      const lang = langFromFence(code?.props.className);
      if (!lang) return <pre>{children}</pre>;
      const text = code?.props.children;
      return (
        <LangBlock lang={lang}>
          {typeof text === 'string' ? text.replace(/\n$/, '') : text}
        </LangBlock>
      );
    },
  };
}
