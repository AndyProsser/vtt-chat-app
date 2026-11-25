import type { TestRow } from '@vtt-chat-app/shared';

import { classifyIp } from './address.js';

/**
 * "Is this server's address one the outside world can reach at all?" Many home ISPs put customers behind carrier-grade
 * NAT (CGNAT): the whole street shares one public address, so nothing from outside can reach your server whatever you
 * forward on your router. This compares what the server sees itself as (STUN) with what DNS says and whether the outside
 * checks got in, and says which of those it is.
 */
export interface NetworkOptions {
  webHost: string;
  voiceHost: string;
  /** All the addresses a name resolves to (injected; the real one is dns.lookup). */
  resolve: (host: string) => Promise<string[]>;
  /** The server's public IPv4 as an outside STUN server sees it. */
  publicAddress: () => Promise<string | undefined>;
  /** Whether the outside check reached the web side / the voice TCP port; undefined when not asked. */
  webReachable?: boolean;
  voiceReachable?: boolean;
}

const CGNAT_HELP =
  'Your ISP shares one public address between many customers (carrier-grade NAT), so port forwarding on your router cannot help. ' +
  'Options: ask the ISP for a public IPv4 address (often a business plan or an extra fee), use IPv6 if every player has it, ' +
  'or rent a small VPS and relay to the server over WireGuard (forward UDP 50000-50200 and TCP 7881/443), then run vtt-admin voice-address <the VPS address>. ' +
  'Cloudflare Tunnel cannot carry voice.';

const row = (badge: TestRow['badge'], name: string, detail: string): TestRow => ({
  badge,
  name,
  detail,
});

async function checkName(
  host: string,
  isWeb: boolean,
  own: string | undefined,
  resolve: NetworkOptions['resolve'],
): Promise<TestRow> {
  const name = `DNS ${host}`;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch (e) {
    return row(
      'fail',
      name,
      `does not resolve (${e instanceof Error ? e.message : String(e)}); players cannot find the server.`,
    );
  }
  if (addresses.length === 0)
    return row('fail', name, 'does not resolve to any address; players cannot find the server.');
  const bad = addresses.filter((a) => {
    const c = classifyIp(a);
    return c === 'cgnat' || c === 'private' || c === 'loopback';
  });
  if (bad.length > 0) {
    const kind = classifyIp(bad[0]!) === 'cgnat' ? 'a shared CGNAT' : 'a private';
    return row(
      'fail',
      name,
      `points at ${bad.join(', ')}, ${kind} address that nothing outside your network can reach. Point it at your public address.`,
    );
  }
  if (!own || addresses.includes(own))
    return row('ok', name, `points at ${addresses.join(', ')}${own ? ', this server' : ''}`);
  if (isWeb) {
    return row(
      'ok',
      name,
      `points at ${addresses.join(', ')}, not this server's ${own}; fine if a proxy such as Cloudflare sits in front.`,
    );
  }
  return row(
    'warn',
    name,
    `points at ${addresses.join(', ')} but this server reaches the internet as ${own}. If voice is meant to land here, update the record (or vtt-admin voice-address).`,
  );
}

export async function checkNetwork(options: NetworkOptions): Promise<TestRow[]> {
  const rows: TestRow[] = [];
  const own = await options.publicAddress();
  const ownClass = own ? classifyIp(own) : undefined;

  if (own && (ownClass === 'cgnat' || ownClass === 'private')) {
    rows.push(
      row(
        'fail',
        'CGNAT',
        `this server reaches the internet as ${own}, a shared address. ${CGNAT_HELP}`,
      ),
    );
  } else if (own) {
    rows.push(row('ok', 'Public address', `this server reaches the internet as ${own}`));
  } else {
    rows.push(
      row(
        'off',
        'Public address',
        'could not be learned (outbound UDP to a STUN server is blocked or timed out)',
      ),
    );
  }

  const usable = ownClass === 'public' ? own : undefined;
  rows.push(await checkName(options.webHost, true, usable, options.resolve));
  if (options.voiceHost.toLowerCase() !== options.webHost.toLowerCase()) {
    rows.push(await checkName(options.voiceHost, false, usable, options.resolve));
  }

  if (
    ownClass !== 'cgnat' &&
    ownClass !== 'private' &&
    options.webReachable === false &&
    options.voiceReachable === false
  ) {
    rows.push(
      row(
        'warn',
        'CGNAT?',
        `nothing outside could reach the server${own ? ` at ${own}` : ''}. If port forwarding is set up, your ISP may be sharing your address (CGNAT). ` +
          'Compare the WAN IP on your router admin page with the address above: if they differ, or the router shows 100.64.x.x to 100.127.x.x, that is CGNAT. ' +
          CGNAT_HELP,
      ),
    );
  }
  return rows;
}
