/** `ABCD2345` → `ABCD-2345`; idempotent on an already grouped code. */
export function formatCode(code: string): string {
  const raw = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function isExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}
