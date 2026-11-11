import { LINK_CODE_MARGIN_MS, LINK_CODE_TTL_MS } from '../consts/index.js';

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

/** Client-side deadline for a code received at `receivedAt` (client clock). */
export function deadlineFor(receivedAt: number): number {
  return receivedAt + LINK_CODE_TTL_MS - LINK_CODE_MARGIN_MS;
}

export function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
