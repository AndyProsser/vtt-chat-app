import { splitTaleTitle } from '@vtt-chat-app/shared';

import { summaryLabel, type SummaryView } from '../lib/history.js';
import { MarkdownView } from './MarkdownView.js';

/** One summary: the tale, a chapter, a hero, the DM brief or the scribe's notes. */
export function SummaryCard({ s }: { s: SummaryView }) {
  // The storyteller titles the tale on its first line: show that as the heading, and "The tale" beside it.
  const tale = s.kind === 'session' ? splitTaleTitle(s.text) : { title: null, body: s.text };
  return (
    <article className="vtt-session">
      <b>
        {tale.title ?? summaryLabel(s.kind)}
        {tale.title ? <span className="vtt-muted"> · {summaryLabel(s.kind)}</span> : null}
        {s.subject ? `: ${s.subject}` : ''}
        {s.title ? ` · ${s.title}` : ''}
      </b>
      <MarkdownView text={tale.body} />
    </article>
  );
}
