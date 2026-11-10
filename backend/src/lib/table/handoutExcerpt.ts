/** How much of a note travels in the "handout shown" event: enough for a three-line preview in chat. */
export const EXCERPT_CHARS = 400;

/** The start of a text handout for its chat card; nothing for pictures, maps, PDFs or an empty note. */
export function handoutExcerpt(kind: string, body: string | null | undefined): string | undefined {
  if (kind !== 'text' || !body) return undefined;
  const text = body.trim();
  if (text === '') return undefined;
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > EXCERPT_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
