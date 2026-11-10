import { clock } from './format.js';

export interface SnippetPart {
  text: string;
  mark: boolean;
}

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
};

const unescape = (s: string) => s.replace(/&(?:lt|gt|amp|quot|#39);/g, (m) => ENTITIES[m] ?? m);

/**
 * The server sends a snippet as escaped text with the matched words in `<mark>` tags. Split it into
 * parts so the page can draw the marks itself and never has to treat the text as HTML.
 */
export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const [i, piece] of snippet.split(/<\/?mark>/).entries()) {
    if (piece !== '') parts.push({ text: unescape(piece), mark: i % 2 === 1 });
  }
  return parts;
}

export interface HitSource {
  source: 'transcript' | 'summary' | 'chat';
  kind?: string | undefined;
  speakerName?: string | undefined;
  atMs?: number | undefined;
}

/** "Ann at 1:05", "Bo typed at 0:05", "Summary: session". */
export function hitLabel(hit: HitSource): string {
  if (hit.source === 'summary') return `Summary: ${hit.kind ?? 'session'}`;
  const at = hit.atMs === undefined ? '' : ` at ${clock(hit.atMs)}`;
  if (hit.source === 'chat') return `${hit.speakerName ?? 'Someone'} typed${at}`;
  return hit.speakerName ? `${hit.speakerName}${at}` : 'Spoken';
}
