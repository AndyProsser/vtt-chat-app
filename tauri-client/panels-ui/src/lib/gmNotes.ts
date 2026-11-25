// The notes page's own helpers (sizes, attachments, links, the starter text) live in `shared/`, used by the phone app too.
export { attachmentProblem, editorStart, isWebLink, sizeLabel } from '@vtt-chat-app/shared';

/** "a, b ,c,," as a list of aliases, and back. */
export const parseAliases = (text: string): string[] =>
  text
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
export const aliasesText = (aliases: readonly string[]): string => aliases.join(', ');
