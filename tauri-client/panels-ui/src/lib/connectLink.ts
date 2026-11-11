import type { ConnectLink } from '../types/index.js';

/** Reads a pasted `vtt-chat://connect?server=…&code=…` link; `null` if it is anything else. */
export function parseConnectLink(text: string): ConnectLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'vtt-chat:' || url.hostname !== 'connect') return null;
  const server = url.searchParams.get('server')?.trim();
  if (!server) return null;
  const code = url.searchParams.get('code')?.trim();
  return { server, code: code ? code : null };
}
