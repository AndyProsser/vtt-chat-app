import type { AiSettings } from '../types/aiSettings.js';

/**
 * Where a recorded session's content is processed, for the notice every participant sees (CLAUDE.md §8.4;
 * RECORDING-AND-SUMMARIES.md "Telling the table", decided by Andy 2026-11-17):
 *
 * - `local`: on the operator's own server, or a machine on the operator's own network (a gaming PC with a GPU);
 * - `offsite`: anywhere else, i.e. a third party's cloud (the Claude connector arrives in 0.6.2).
 */
export type ProcessingLocation = 'local' | 'offsite';

/**
 * Whether a host is on the operator's own network: a loopback, private or link-local address (10/8, 172.16/12,
 * 192.168/16, 127/8, IPv6 ::1, ULA fc00::/7 and link-local fe80::/10), a single-label name, or a name ending in
 * `.local`, `.lan`, `.internal` or `.home.arpa`. Anything else is not.
 */
export function isOwnNetworkHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host === '') return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (host.includes(':')) {
    return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  if (!host.includes('.')) return true;
  return ['.local', '.lan', '.internal', '.home.arpa'].some((suffix) => host.endsWith(suffix));
}

/** `offsite` when any configured remote backend is not on the operator's own network; otherwise `local`. */
export function processingLocation(ai: AiSettings): ProcessingLocation {
  // Claude and OpenAI are always off-site: the transcript text goes to Anthropic or OpenAI.
  if (ai.llm.kind === 'claude' || ai.llm.kind === 'openai') return 'offsite';
  for (const backend of [ai.transcription, ai.llm]) {
    if (backend.kind !== 'remote' || backend.url === null) continue;
    try {
      if (!isOwnNetworkHost(new URL(backend.url).hostname)) return 'offsite';
    } catch {
      return 'offsite'; // an address we cannot read is not one we can vouch for
    }
  }
  return 'local';
}
