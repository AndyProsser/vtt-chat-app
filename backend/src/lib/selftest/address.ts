/**
 * What kind of address an IP is, for the self-tests: "public" can be reached from the internet, "cgnat" is the shared
 * 100.64.0.0/10 range ISPs hand out when many customers sit behind one public address (RFC 6598), "private" and
 * "loopback" never leave the building. Anything that is not an IP address has no class.
 */
export type IpClass = 'public' | 'cgnat' | 'private' | 'loopback';

export function classifyIp(ip: string): IpClass | undefined {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return 'loopback';
    if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
    if (
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return 'private';
    }
    return 'public';
  }
  if (ip.includes(':')) {
    const h = ip.toLowerCase();
    if (h === '::1') return 'loopback';
    if (/^f[cd]/.test(h) || h.startsWith('fe80') || h === '::') return 'private';
    return 'public';
  }
  return undefined;
}
