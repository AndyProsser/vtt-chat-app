const MAX_DEVICE_LABEL = 80;

/**
 * C0/C1 controls, plus zero-width and direction marks (U+200B–U+200F), bidi embeddings and overrides
 * (U+202A–U+202E), bidi isolates (U+2066–U+2069) and the byte-order mark / zero-width no-break space.
 */
// eslint-disable-next-line no-control-regex
const UNSHOWABLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * A device label comes from unauthenticated input (a body field or the `x-device-label` header) and
 * is later shown to people and stored on sessions, so it is stripped of control characters and of
 * invisible formatting and bidirectional-override characters (which could make it render misleadingly),
 * trimmed and capped. Returns `undefined` when nothing is left.
 */
export function cleanDeviceLabel(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(UNSHOWABLE, '').trim();
  const capped = [...cleaned].slice(0, MAX_DEVICE_LABEL).join('').trim();
  return capped === '' ? undefined : capped;
}

/**
 * The same stripping for other unauthenticated free text (a sign-up request's name and message):
 * unshowable characters removed, ends trimmed. With `keepNewlines`, line breaks and tabs survive
 * (a multi-line message) while every other control character still goes.
 */
export function stripUnshowable(raw: string, keepNewlines = false): string {
  const kept = keepNewlines ? raw.replace(/\r\n?/g, '\n') : raw;
  return kept
    .replace(UNSHOWABLE, (c) => (keepNewlines && (c === '\n' || c === '\t') ? c : ''))
    .trim();
}
