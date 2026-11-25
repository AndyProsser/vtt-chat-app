import { describe, expect, it } from 'vitest';

import { bindingRequest, parseBindingResponse, stunPublicAddress } from './stun.js';

const MAGIC = 0x2112a442;

/** A STUN success response carrying `ip:port` as XOR-MAPPED-ADDRESS, for the request's transaction. */
function response(
  request: Buffer,
  ip: string,
  port: number,
  attr: 'xor' | 'plain' = 'xor',
): Buffer {
  const parts = ip.split('.').map(Number);
  const body = Buffer.alloc(12);
  body.writeUInt16BE(attr === 'xor' ? 0x0020 : 0x0001, 0);
  body.writeUInt16BE(8, 2);
  body.writeUInt8(0, 4);
  body.writeUInt8(1, 5); // IPv4
  const xor = attr === 'xor';
  body.writeUInt16BE(xor ? port ^ (MAGIC >>> 16) : port, 6);
  const addr = Buffer.from(parts);
  if (xor) {
    const magic = Buffer.alloc(4);
    magic.writeUInt32BE(MAGIC);
    for (let i = 0; i < 4; i++) addr[i] = addr[i]! ^ magic[i]!;
  }
  addr.copy(body, 8);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(0x0101, 0);
  header.writeUInt16BE(body.length, 2);
  request.copy(header, 4, 4, 20); // magic cookie and transaction id, copied back
  return Buffer.concat([header, body]);
}

describe('bindingRequest', () => {
  it('is a 20-byte STUN binding request with the magic cookie and a fresh transaction id', () => {
    const a = bindingRequest();
    const b = bindingRequest();
    expect(a).toHaveLength(20);
    expect(a.readUInt16BE(0)).toBe(0x0001);
    expect(a.readUInt16BE(2)).toBe(0);
    expect(a.readUInt32BE(4)).toBe(MAGIC);
    expect(a.subarray(8).equals(b.subarray(8))).toBe(false);
  });
});

describe('parseBindingResponse', () => {
  it('reads the public address out of an XOR-MAPPED-ADDRESS', () => {
    const req = bindingRequest();
    expect(parseBindingResponse(response(req, '203.0.113.9', 54321), req)).toBe('203.0.113.9');
  });

  it('reads a plain MAPPED-ADDRESS from an older server', () => {
    const req = bindingRequest();
    expect(parseBindingResponse(response(req, '198.51.100.7', 3478, 'plain'), req)).toBe(
      '198.51.100.7',
    );
  });

  it('ignores an answer to some other request, a short one, and an error', () => {
    const req = bindingRequest();
    const other = bindingRequest();
    expect(parseBindingResponse(response(other, '203.0.113.9', 1), req)).toBeUndefined();
    expect(parseBindingResponse(Buffer.alloc(5), req)).toBeUndefined();
    const error = response(req, '203.0.113.9', 1);
    error.writeUInt16BE(0x0111, 0);
    expect(parseBindingResponse(error, req)).toBeUndefined();
  });
});

describe('stunPublicAddress', () => {
  it('asks a STUN server and gives back the address it saw', async () => {
    const ip = await stunPublicAddress({
      exchange: async (req) => response(req, '203.0.113.9', 4000),
    });
    expect(ip).toBe('203.0.113.9');
  });

  it('gives back nothing, never throws, when there is no answer or the exchange fails', async () => {
    expect(await stunPublicAddress({ exchange: async () => undefined })).toBeUndefined();
    expect(
      await stunPublicAddress({
        exchange: async () => {
          throw new Error('EACCES');
        },
      }),
    ).toBeUndefined();
  });
});
