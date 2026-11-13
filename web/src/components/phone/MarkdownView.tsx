import Markdown from 'react-markdown';

/**
 * Note and session text. Markdown only: raw HTML is dropped, pictures are not fetched and links are shown as
 * text, so a note can format but never reach out. The same rules as the desktop app's handout viewer.
 * Loaded on demand (see LazyMarkdown) so the chat itself does not carry the parser.
 */
export default function MarkdownView({ text }: { text: string }) {
  return (
    <div className="phone-md">
      <Markdown
        skipHtml
        components={{
          a: ({ children }) => <span className="phone-md-link">{children}</span>,
          img: () => null,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
