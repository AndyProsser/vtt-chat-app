/**
 * Which check-host.net places to ask from. Asking only from the other side of the world misses what the server's own
 * neighbours see (and a country-blocking rule on the site hides the failure), so the first place is the one nearest the
 * server: its own country when check-host has a node there, otherwise the closest country that does (there is none in
 * Australia or New Zealand, so those use Singapore or Indonesia). The rest are random, from different countries.
 */
export type NodeList = Record<string, { location: [string, string, string] }>;

/** Countries to try, nearest first, when there is no node at home. */
const NEAREST: Record<string, string[]> = {
  au: ['sg', 'id', 'hk', 'jp', 'vn', 'in'],
  nz: ['sg', 'id', 'hk', 'jp', 'vn', 'in'],
  sg: ['id', 'hk', 'vn', 'jp', 'in'],
  jp: ['hk', 'sg', 'vn', 'id'],
  gb: ['nl', 'fr', 'de', 'se'],
  ie: ['gb', 'nl', 'fr', 'de'],
  ca: ['us'],
  mx: ['us'],
  za: ['es', 'pt', 'fr', 'it'],
};

const countryOf = (nodes: NodeList, name: string): string => nodes[name]?.location[0] ?? '';

export function pickNodes(
  all: NodeList,
  country: string | undefined,
  count: number,
  random: () => number = Math.random,
  preferred: string[] = [],
): string[] {
  const names = Object.keys(all);
  const picked: string[] = [];
  // Countries the operator asked for (a site that blocks other countries is only reachable from some): one node each, first.
  for (const cc of preferred.map((c) => c.toLowerCase())) {
    const home = names.filter((n) => countryOf(all, n) === cc);
    if (home.length > 0 && picked.length < count)
      picked.push(home[Math.floor(random() * home.length)]!);
  }
  const near = country ? [country, ...(NEAREST[country] ?? [])] : [];
  for (const cc of near) {
    if (picked.length >= count) break;
    const home = names.filter((n) => countryOf(all, n) === cc);
    if (home.length > 0) {
      picked.push(home[Math.floor(random() * home.length)]!);
      break;
    }
  }
  // Then variety: one more from each country not used yet, in random order, before repeating a country.
  const rest = names.filter((n) => !picked.includes(n));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  const seen = new Set(picked.map((n) => countryOf(all, n)));
  for (const n of rest) {
    if (picked.length >= count) break;
    if (!seen.has(countryOf(all, n))) {
      picked.push(n);
      seen.add(countryOf(all, n));
    }
  }
  for (const n of rest) {
    if (picked.length >= count) break;
    if (!picked.includes(n)) picked.push(n);
  }
  return picked.slice(0, count);
}

/** Of the countries asked for, the ones check-host.net has no node in. */
export function missingCountries(all: NodeList, wanted: string[]): string[] {
  const have = new Set(Object.values(all).map((n) => n.location[0]));
  return wanted.map((c) => c.toLowerCase()).filter((c) => !have.has(c));
}

/** The two-letter country of an IP address, as check-host.net's own IP page reports it; nothing if it cannot be learned. */
export async function serverCountry(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(
      `https://check-host.net/ip-info?host=${encodeURIComponent(address)}`,
      {
        headers: { 'User-Agent': 'vtt-chat-app vtt-admin (self-hosted server reachability check)' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return undefined;
    const m = /<td>Country<\/td>[\s\S]{0,300}?\(([A-Z]{2})\)/.exec(await res.text());
    return m?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}
