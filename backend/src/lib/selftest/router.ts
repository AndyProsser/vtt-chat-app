import { createSocket } from 'node:dgram';
import { readFile } from 'node:fs/promises';

/**
 * Asks the home router what public address it has, using UPnP or NAT-PMP, the two ways a router tells a device on the LAN.
 * A router that does not answer (many have both off) simply gives nothing, so this only ever adds certainty. Compared with
 * what the internet sees (STUN), a router address that is shared (100.64.0.0/10) or different proves CGNAT instead of guessing.
 */
export interface RouterAddress {
  address: string;
  via: 'UPnP' | 'NAT-PMP';
}

export const natpmpRequest = (): Buffer => Buffer.from([0, 0]);

export function parseNatpmpResponse(res: Buffer): string | undefined {
  if (res.length < 12 || res[0] !== 0 || res[1] !== 128 || res.readUInt16BE(2) !== 0)
    return undefined;
  return [...res.subarray(8, 12)].join('.');
}

/** The gateway of the default route, from the text of /proc/net/route (addresses there are little-endian hex). */
export function defaultGateway(route: string): string | undefined {
  for (const line of route.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f[1] === '00000000' && f[2] && /^[0-9A-Fa-f]{8}$/.test(f[2]) && f[2] !== '00000000') {
      const b = f[2].match(/../g)!.map((h) => parseInt(h, 16));
      return b.reverse().join('.');
    }
  }
  return undefined;
}

export function parseSsdpLocation(res: string): string | undefined {
  return /^location:\s*(\S+)/im.exec(res)?.[1];
}

export function controlEndpoint(
  xml: string,
  descriptionUrl: string,
): { url: string; serviceType: string } | undefined {
  for (const m of xml.matchAll(/<service>([\s\S]*?)<\/service>/g)) {
    const type = /<serviceType>\s*([^<\s]+)\s*<\/serviceType>/.exec(m[1]!)?.[1];
    const control = /<controlURL>\s*([^<\s]+)\s*<\/controlURL>/.exec(m[1]!)?.[1];
    if (type && control && /:(WANIPConnection|WANPPPConnection):/.test(type)) {
      return { url: new URL(control, descriptionUrl).toString(), serviceType: type };
    }
  }
  return undefined;
}

export const soapExternalIpRequest = (serviceType: string): string =>
  '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
  `<s:Body><u:GetExternalIPAddress xmlns:u="${serviceType}"></u:GetExternalIPAddress></s:Body></s:Envelope>`;

export const parseExternalIp = (xml: string): string | undefined =>
  /<NewExternalIPAddress>\s*([^<\s]+)\s*<\/NewExternalIPAddress>/.exec(xml)?.[1];

const TIMEOUT_MS = 2_500;

function udp(host: string, port: number, payload: Buffer): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const done = (v?: Buffer): void => {
      clearTimeout(timer);
      socket.close();
      resolve(v);
    };
    const timer = setTimeout(() => done(), TIMEOUT_MS);
    socket.once('message', (m) => done(m));
    socket.once('error', () => done());
    socket.send(payload, port, host, (e) => e && done());
  });
}

async function natpmpReal(): Promise<string | undefined> {
  const gateway = defaultGateway(await readFile('/proc/net/route', 'utf8'));
  if (!gateway) return undefined;
  const res = await udp(gateway, 5351, natpmpRequest());
  return res ? parseNatpmpResponse(res) : undefined;
}

async function upnpReal(): Promise<string | undefined> {
  const search = Buffer.from(
    'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n',
  );
  const answer = await udp('239.255.255.250', 1900, search);
  const location = answer && parseSsdpLocation(answer.toString('utf8'));
  if (!location) return undefined;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const desc = await (await fetch(location, { signal })).text();
  const control = controlEndpoint(desc, location);
  if (!control) return undefined;
  const res = await fetch(control.url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPAction: `"${control.serviceType}#GetExternalIPAddress"`,
    },
    body: soapExternalIpRequest(control.serviceType),
  });
  return parseExternalIp(await res.text());
}

export async function routerWanAddress(
  probes: {
    natpmp?: () => Promise<string | undefined>;
    upnp?: () => Promise<string | undefined>;
  } = {},
): Promise<RouterAddress | undefined> {
  const safe = (p: () => Promise<string | undefined>) => p().catch(() => undefined);
  const [pmp, upnp] = await Promise.all([
    safe(probes.natpmp ?? natpmpReal),
    safe(probes.upnp ?? upnpReal),
  ]);
  if (pmp) return { address: pmp, via: 'NAT-PMP' };
  if (upnp) return { address: upnp, via: 'UPnP' };
  return undefined;
}
