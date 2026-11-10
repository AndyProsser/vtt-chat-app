/** The bytes inside a `data:<type>;base64,<data>` URL, or `undefined` if it is not one. */
export function bytesFromDataUrl(url: string): Uint8Array | undefined {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(url);
  if (!match) return undefined;
  try {
    const binary = atob(match[1] ?? '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}
