/**
 * The character id in a D&D Beyond character link. Accepts the public sheet address
 * (`https://www.dndbeyond.com/characters/12345678`, with or without a trailing segment or query) and
 * a bare number. Anything else is refused: the id is later used to build a request, so it must be digits.
 */
const SHEET_URL =
  /^https:\/\/(?:www\.)?dndbeyond\.com\/(?:profile\/[^/]+\/)?characters\/(\d{1,12})(?:[/?#].*)?$/i;

export function characterIdFromUrl(input: string): string | undefined {
  const text = input.trim();
  if (/^\d{1,12}$/.test(text)) return text;
  return SHEET_URL.exec(text)?.[1];
}

/** The public sheet address for an id, used as the link we store and show. */
export function characterSheetUrl(id: string): string {
  return `https://www.dndbeyond.com/characters/${id}`;
}
