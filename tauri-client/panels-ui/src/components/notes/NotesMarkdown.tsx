import { forwardRef } from 'react';
import Markdown from 'react-markdown';

import { isWebLink } from '../../lib/gmNotes.js';
import { openExternalLink } from '../../lib/tauriBridge.js';

/**
 * The Game Master's notes, drawn. Raw HTML is dropped and pictures are not fetched (the app never loads from the
 * web), but links work: a web link opens in the system's default browser and never inside the app; any other
 * link is plain text.
 */
export const NotesMarkdown = forwardRef<HTMLDivElement, { text: string }>(function NotesMarkdown(
  { text },
  ref,
) {
  return (
    <div className="vtt-md vtt-notes-md" ref={ref}>
      <Markdown
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) =>
            isWebLink(href) ? (
              <a
                href={href}
                className="vtt-md-anchor"
                rel="noreferrer noopener"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalLink(href).catch(console.error);
                }}
              >
                {children}
              </a>
            ) : (
              <span className="vtt-md-link">{children}</span>
            ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});
