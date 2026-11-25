import { langUrlTransform, makeLangComponents } from '@vtt-chat-app/ui-kit';
import Markdown from 'react-markdown';

// Handouts may set a few words, or a whole inscription, in an in-world language (docs/architecture/RPG-MARKDOWN-EXTENSION.md).
const components = { ...makeLangComponents('vtt-md-link'), img: () => null };

/**
 * Handout text. Markdown only: raw HTML is dropped, pictures are not fetched (the app never loads
 * from the web) and links are shown as text, so a handout can format but never reach out. A `[words](lang:dwarvish)`
 * link, or a fenced block named for a language, is set in that language's font instead.
 */
export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="vtt-md">
      <Markdown skipHtml urlTransform={langUrlTransform} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
