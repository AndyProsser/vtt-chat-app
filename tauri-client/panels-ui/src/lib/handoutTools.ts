import type { Handout } from '../types/index.js';

/** Handouts whose title or text contains every word of `query` (case-insensitive); all of them for a blank query. */
export function searchHandouts(handouts: Handout[], query: string): Handout[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return handouts;
  return handouts.filter((h) => {
    const haystack = `${h.title}\n${h.body ?? ''}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** Has any player been shown it? (`dm` means only the DM can see it.) */
export const isShared = (h: Handout): boolean => h.visibility !== 'dm';

/** What to tell the DM before removing it, or `null` if nobody else has seen it. */
export function removalWarning(h: Handout): string | null {
  if (h.visibility === 'all')
    return 'This was shown to the players. Removing it takes it away from them too.';
  if (h.visibility === 'some')
    return 'This was shown to some players. Removing it takes it away from them too.';
  return null;
}

interface ClipboardLike {
  kind: string;
  type: string;
  getAsFile(): File | null;
}

/** The first picture on the clipboard (a pasted screenshot or copied image), if any. */
export function imageFromClipboard(
  items: ArrayLike<ClipboardLike>,
  files?: ArrayLike<File>,
): File | undefined {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  // Some webviews put a pasted picture in `files` rather than `items`.
  for (let i = 0; files && i < files.length; i += 1) {
    if (files[i]!.type.startsWith('image/')) return files[i];
  }
  return undefined;
}

/** A title for a picture that arrived without one, from the time it was pasted. */
export function pastedTitle(now: Date): string {
  const day = now.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `Picture ${day} ${time}`;
}

/** A file's bytes as base64, for the command that uploads it. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('could not read the picture'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

/** A base64 string as a file of the given type (for a picture Rust read from the clipboard). */
export function fileFromBase64(base64: string, type: string, name: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

/** A note's words without its Markdown marks, on one line: what a chat card shows before it is opened. */
export function plainPreview(markdown: string): string {
  return markdown
    .replace(/^\s{0,3}(#{1,6}|>|[-*+])\s+/gm, '')
    .replace(/(\*\*|__|\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pictures in one handout; the server's limit, repeated so the form can say so before uploading. */
export const MAX_PICTURES = 12;

export type NewHandoutMode = 'note' | 'pictures' | 'pdf';

/** Whether the "new handout" form has what the server needs: a title, and content that fits the kind. */
export function canCreateHandout(f: {
  mode: NewHandoutMode;
  title: string;
  text: string;
  pictures: number;
  hasPdf: boolean;
}): boolean {
  if (f.title.trim() === '') return false;
  if (f.mode === 'note') return f.text.trim() !== '';
  if (f.mode === 'pictures') return f.pictures >= 1 && f.pictures <= MAX_PICTURES;
  return f.hasPdf;
}
