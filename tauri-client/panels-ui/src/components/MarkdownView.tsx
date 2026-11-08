import Markdown from 'react-markdown';

/**
 * Handout text. Markdown only: raw HTML is dropped, pictures are not fetched (the app never loads
 * from the web) and links are shown as text, so a handout can format but never reach out.
 */
export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="vtt-md">
      <Markdown
        skipHtml
        components={{
          a: ({ children }) => <span className="vtt-md-link">{children}</span>,
          img: () => null,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
