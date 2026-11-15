/** Escapes text for HTML bodies and double-quoted attributes. Numeric references, so it is safe in both. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
