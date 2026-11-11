/** The host to show next to Connect, so a hostile link's server is visible; `null` if not an address yet. */
export function serverHost(server: string): string | null {
  const text = server.trim();
  if (text === '') return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).host || null;
  } catch {
    return null;
  }
}
