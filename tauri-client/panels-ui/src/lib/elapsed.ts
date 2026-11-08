/** Milliseconds since `startedAt` (epoch ms), never negative; 0 when the start is unknown. */
export function elapsedSince(startedAt: number | null, now: number): number {
  if (startedAt === null) return 0;
  return Math.max(0, now - startedAt);
}

/** `HH:MM:SS`; a negative or non-finite duration shows as zero rather than a nonsense time. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
