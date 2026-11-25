import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';

/**
 * Asks a STUN server "what address do you see me as?", which is this server's real address on the internet whatever its
 * router or ISP does in between. LiveKit already uses Google's STUN by default, so this adds no new third party to the
 * install. Used to tell a normal public address from a shared (CGNAT) one.
 */
const MAGIC = 0x2112a442;
const DEFAULT_SERVER = { host: 'stun.l.google.com', port: 19302 };

/** A STUN binding request: 20 bytes, a random transaction id, no attributes. */
export function bindingRequest(): Buffer {
  const b = Buffer.alloc(20);
  b.writeUInt16BE(0x0001, 0);
  b.writeUInt16BE(0, 2);
  b.writeUInt32BE(MAGIC, 4);
  randomBytes(12).copy(b, 8);
  return b;
}

/** The IPv4 address a binding response reports, or nothing if it is not a success answer to `request`. */
export function parseBindingResponse(res: Buffer, request: Buffer): string | undefined {
  if (res.length < 20 || res.readUInt16BE(0) !== 0x0101) return undefined;
  if (!res.subarray(4, 20).equals(request.subarray(4, 20))) return undefined;
  const end = Math.min(res.length, 20 + res.readUInt16BE(2));
  let plain: string | undefined;
  for (let at = 20; at + 4 <= end;) {
    const type = res.readUInt16BE(at);
    const len = res.readUInt16BE(at + 2);
    const v = at + 4;
    if (
      (type === 0x0020 || type === 0x0001) &&
      len >= 8 &&
      res.readUInt8(v + 1) === 1 &&
      v + 8 <= res.length
    ) {
      const bytes = [...res.subarray(v + 4, v + 8)];
      if (type === 0x0020) {
        const magic = Buffer.alloc(4);
        magic.writeUInt32BE(MAGIC);
        return bytes.map((x, i) => x ^ magic[i]!).join('.');
      }
      plain = bytes.join('.');
    }
    at = v + len + ((4 - (len % 4)) % 4);
  }
  return plain;
}

export interface StunOptions {
  server?: { host: string; port: number };
  timeoutMs?: number;
  /** Sends the request, returns the reply (injected in tests; the real one is a UDP socket). */
  exchange?: (request: Buffer) => Promise<Buffer | undefined>;
}

function udpExchange(server: { host: string; port: number }, timeoutMs: number) {
  return (request: Buffer): Promise<Buffer | undefined> =>
    new Promise((resolve, reject) => {
      const socket = createSocket('udp4');
      const finish = (v?: Buffer, err?: Error): void => {
        clearTimeout(timer);
        socket.close();
        if (err) reject(err);
        else resolve(v);
      };
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      socket.once('message', (msg) => finish(msg));
      socket.once('error', (e) => finish(undefined, e));
      socket.send(request, server.port, server.host, (e) => {
        if (e) finish(undefined, e);
      });
    });
}

/** This machine's public IPv4 as a STUN server sees it; nothing when it cannot be learned (no UDP out, no answer). */
export async function stunPublicAddress(options: StunOptions = {}): Promise<string | undefined> {
  const exchange =
    options.exchange ?? udpExchange(options.server ?? DEFAULT_SERVER, options.timeoutMs ?? 4_000);
  const request = bindingRequest();
  try {
    const reply = await exchange(request);
    return reply ? parseBindingResponse(reply, request) : undefined;
  } catch {
    return undefined;
  }
}
