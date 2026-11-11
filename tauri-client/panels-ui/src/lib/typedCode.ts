/** Longest code worth showing in the typed-code box: a short code (`ABCD-2345`) or an emailed one. */
const MAX_TYPEABLE = 16;

/**
 * Whether `code` is something a person would type. A long single-use token (what the web page's deep link
 * carries) is not: it is kept for a retry but never rendered as a giant string in the box.
 */
export function isTypeableCode(code: string): boolean {
  return code.length <= MAX_TYPEABLE;
}
