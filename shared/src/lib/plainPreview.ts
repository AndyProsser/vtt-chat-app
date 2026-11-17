/**
 * A note's words without its Markdown marks, on one line: what a chat card or a list row shows before the note
 * is opened. Used by the desktop panels and the phone app, so both read the same.
 */
export function plainPreview(markdown: string): string {
  return markdown
    .replace(/^\s{0,3}(#{1,6}|>|[-*+])\s+/gm, '')
    .replace(/(\*\*|__|\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}
