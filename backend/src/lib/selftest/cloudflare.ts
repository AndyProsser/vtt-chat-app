/**
 * Whether an address belongs to Cloudflare's proxy (their published ranges, https://www.cloudflare.com/ips/). A web name that
 * resolves to one is behind Cloudflare, which carries the website but never voice, so voice has to be checked at the
 * server's own address.
 */
const V4: [string, number][] = [
  ['173.245.48.0', 20],
  ['103.21.244.0', 22],
  ['103.22.200.0', 22],
  ['103.31.4.0', 22],
  ['141.101.64.0', 18],
  ['108.162.192.0', 18],
  ['190.93.240.0', 20],
  ['188.114.96.0', 20],
  ['197.234.240.0', 22],
  ['198.41.128.0', 17],
  ['162.158.0.0', 15],
  ['104.16.0.0', 13],
  ['104.24.0.0', 14],
  ['172.64.0.0', 13],
  ['131.0.72.0', 22],
];

const toInt = (ip: string): number => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);

export function isCloudflareIp(ip: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const n = toInt(ip);
    return V4.some(([base, bits]) => {
      const size = 2 ** (32 - bits);
      const start = toInt(base);
      return n >= start && n < start + size;
    });
  }
  return /^2(606:4700|803:f800|405:b500|405:8100|a06:98c0|c0f:f248)/i.test(ip);
}
