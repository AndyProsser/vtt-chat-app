import { GM_NOTES_STARTER } from '@vtt-chat-app/shared';

/** "3.2 MB", "840 KB", "12 B": a file's size for the attachment list. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** Why a file cannot be attached, or `null` if it can: a picture or PDF no larger than the server's ceiling. */
export function attachmentProblem(
  file: { name: string; type: string; size: number },
  maxBytes: number,
): string | null {
  const ok =
    /^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
    file.type === 'application/pdf' ||
    /\.(png|jpe?g|gif|webp|pdf)$/i.test(file.name);
  if (!ok) return 'Attachments are pictures (PNG, JPEG, GIF or WebP) and PDFs.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxBytes)
    return `That file is ${sizeLabel(file.size)}; this server takes up to ${sizeLabel(maxBytes)} (the operator can raise it).`;
  return null;
}

/** Only web links open, and only in the system browser; anything else in the notes is plain text. */
export function isWebLink(href: string | undefined): href is string {
  return href !== undefined && /^https?:\/\/[^\s/]+/i.test(href);
}

/** What the editor starts with: the page as saved, or the starter headings for a page that has never had text. */
export function editorStart(body: string): string {
  return body.trim() === '' ? GM_NOTES_STARTER : body;
}

/** "a, b ,c,," as a list of aliases, and back. */
export const parseAliases = (text: string): string[] =>
  text
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
export const aliasesText = (aliases: readonly string[]): string => aliases.join(', ');
