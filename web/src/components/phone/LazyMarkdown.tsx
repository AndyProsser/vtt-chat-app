import { lazy, Suspense } from 'react';

const MarkdownView = lazy(() => import('./MarkdownView.js'));

/** Rendered Markdown, with the plain text showing for the instant the parser takes to arrive. */
export function LazyMarkdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="phone-note">{text}</div>}>
      <MarkdownView text={text} />
    </Suspense>
  );
}
