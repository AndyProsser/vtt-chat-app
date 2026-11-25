import { createSocket } from 'node:dgram';

/**
 * A short-lived UDP listener that answers every datagram. Voice's UDP cannot be proved by looking at an idle LiveKit (it opens
 * a media port only for a call), but this can: park a listener on a free port inside the media range, ask check-host.net
 * to send UDP there from several countries, and a reply proves the router forwards that range to this machine.
 */
export interface UdpEcho {
  port: number;
  close: () => Promise<void>;
}

export interface UdpEchoOptions {
  /** Ports to try, in order (0 means any free port, for tests). Default: the top of LiveKit's media range, downward. */
  ports?: number[];
  /** Shuts itself down after this long (default 90 s) so a forgotten listener never lingers. */
  lifetimeMs?: number;
}

export const MEDIA_RANGE_TOP_DOWN: number[] = Array.from({ length: 51 }, (_, i) => 50199 - i);

export async function startUdpEcho(options: UdpEchoOptions = {}): Promise<UdpEcho | undefined> {
  for (const port of options.ports ?? MEDIA_RANGE_TOP_DOWN) {
    const socket = createSocket('udp4');
    const bound = await new Promise<boolean>((resolve) => {
      socket.once('error', () => resolve(false));
      socket.bind(port, '0.0.0.0', () => resolve(true));
    });
    if (!bound) {
      socket.close();
      continue;
    }
    socket.on('error', () => undefined);
    socket.on('message', (_msg, rinfo) => socket.send('pong', rinfo.port, rinfo.address));
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      await new Promise<void>((r) => socket.close(() => r()));
    };
    const timer = setTimeout(() => void close(), options.lifetimeMs ?? 90_000);
    timer.unref();
    return { port: socket.address().port, close };
  }
  return undefined;
}
