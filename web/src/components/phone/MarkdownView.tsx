import { langUrlTransform, makeLangComponents } from '@vtt-chat-app/ui-kit';
import Markdown from 'react-markdown';

// Notes and handouts may set a few words, or a whole inscription, in an in-world language (docs/architecture/RPG-MARKDOWN-EXTENSION.md).
const components = { ...makeLangComponents('phone-md-link'), img: () => null };

/**
 * Note and session text. Markdown only: raw HTML is dropped, pictures are not fetched and links are shown as
 * text, so a note can format but never reach out. The same rules as the desktop app's handout viewer, including
 * `[words](lang:dwarvish)` and language-named code fences.
 * Loaded on demand (see LazyMarkdown) so the chat itself does not carry the parser.
 */
export default function MarkdownView({ text }: { text: string }) {
  return (
    <div className="phone-md">
      <Markdown skipHtml urlTransform={langUrlTransform} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
