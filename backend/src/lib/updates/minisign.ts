import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Verifies a Tauri updater signature (minisign, the format `tauri signer` writes) over a file.
 *
 * Why the server checks at all: the app verifies every installer itself against the key compiled into it, so a
 * bad file could never install. But a mirror that served one would leave every player on a broken update with
 * no explanation, so the server refuses to store a file that does not verify, and says so.
 *
 * Both inputs are the base64 strings Tauri uses: the public key from `tauri.conf.json` and the contents of a
 * `.sig` file. Each decodes to a small minisign text file.
 */
export async function verifyMinisign(
  publicKeyBase64: string,
  signatureBase64: string,
  file: string,
): Promise<boolean> {
  try {
    const key = parsePublicKey(publicKeyBase64);
    const sig = parseSignature(signatureBase64);
    if (!key.id.equals(sig.keyId)) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.key]),
      format: 'der',
      type: 'spki',
    });
    // 'ED' signs the BLAKE2b-512 hash of the file (what `tauri signer` writes); 'Ed' signs the bytes themselves.
    const message = sig.prehashed ? await hashFile(file) : await readAll(file);
    if (!verify(null, message, publicKey, sig.signature)) return false;
    // The trusted comment is covered by a second signature over (signature || comment).
    const global = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment)]);
    return verify(null, global, publicKey, sig.globalSignature);
  } catch {
    return false;
  }
}

function lines(base64: string): string[] {
  return Buffer.from(base64.trim(), 'base64').toString('utf8').split('\n');
}

function parsePublicKey(base64: string): { id: Buffer; key: Buffer } {
  const raw = Buffer.from(lines(base64)[1] ?? '', 'base64');
  if (raw.length !== 42 || raw.subarray(0, 2).toString() !== 'Ed')
    throw new Error('not a minisign public key');
  return { id: raw.subarray(2, 10), key: raw.subarray(10) };
}

function parseSignature(base64: string) {
  const l = lines(base64);
  const raw = Buffer.from(l[1] ?? '', 'base64');
  const algorithm = raw.subarray(0, 2).toString();
  if (raw.length !== 74 || (algorithm !== 'Ed' && algorithm !== 'ED')) {
    throw new Error('not a minisign signature');
  }
  const comment = l[2] ?? '';
  const prefix = 'trusted comment: ';
  if (!comment.startsWith(prefix)) throw new Error('signature has no trusted comment');
  return {
    prehashed: algorithm === 'ED',
    keyId: raw.subarray(2, 10),
    signature: raw.subarray(10),
    trustedComment: comment.slice(prefix.length),
    globalSignature: Buffer.from(l[3] ?? '', 'base64'),
  };
}

function hashFile(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hash = createHash('blake2b512');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest()));
  });
}

function readAll(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    createReadStream(file)
      .on('data', (chunk) => parts.push(Buffer.from(chunk)))
      .on('error', reject)
      .on('end', () => resolve(Buffer.concat(parts)));
  });
}
