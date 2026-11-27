/**
 * A hard stop on a tale's length. The prompt asks for "at most N words", and a model that has been given a
 * few seconds of talk will still sometimes write two hundred (seen 2026-11-27: ten seconds of audio, a
 * 200-word tale full of invented events). The prompt is a request; this is the limit.
 */

/** A tale's words: the title heading does not count against it. */
const bodyWords = (text: string): number => text.split(/\s+/).filter((w) => w !== '').length;

/**
 * Keeps whole sentences, in order, until the next one would take the tale past `maxWords`. The title
 * (a leading `# ` line) is kept and not counted. The first sentence is always kept, so a tale is never emptied.
 * Paragraph breaks between the kept sentences are preserved.
 */
export function trimTaleToWords(text: string, maxWords: number): string {
  const heading = /^(#[^\n]*\n+)/.exec(text)?.[1] ?? '';
  const body = text.slice(heading.length);
  if (bodyWords(body) <= maxWords) return text;

  // Sentences with the whitespace that follows them, so the original paragraphing survives the cut.
  const pieces = body.match(/[^.!?…]+(?:[.!?…]+["'”’)]*)?\s*/g) ?? [body];
  let kept = '';
  let count = 0;
  for (const piece of pieces) {
    const n = bodyWords(piece);
    if (kept !== '' && count + n > maxWords) break;
    kept += piece;
    count += n;
  }
  return heading + kept.trimEnd();
}
