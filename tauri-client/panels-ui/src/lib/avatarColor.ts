const AVATAR_HUES = [0, 25, 50, 90, 140, 180, 210, 250, 280, 320] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministic placeholder avatar color from a participant identity. No display name or
 * portrait exists until Stage 3b's DDB extraction lands, so this only needs to make
 * participants visually distinguishable from each other — the same identity always produces
 * the same color, but there's no attempt at personalization.
 */
export function avatarColor(identity: string): string {
  const hue = AVATAR_HUES[hashString(identity) % AVATAR_HUES.length];
  return `hsl(${hue}, 55%, 45%)`;
}
