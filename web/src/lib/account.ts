import { MIN_PASSWORD_LENGTH } from '../consts/index.js';
import { ACCOUNT_AVATAR_PX, UNKNOWN_SESSION_LABEL } from '../consts/account.js';
import type { AccountSession, AccountUser } from '../types/index.js';
import { ApiError, request } from './api.js';

// ---- API ----

export const loadAccount = () => request<{ user: AccountUser }>('GET', '/api/auth/me');

export const loadSessions = () =>
  request<{ sessions: AccountSession[] }>('GET', '/api/auth/sessions');

export const renameAccount = (displayName: string) =>
  request<{ user: AccountUser }>('PATCH', '/api/auth/me', { body: { displayName } });

/** `value` is `avatar:<id>` from an upload, or `null` to clear the portrait. */
export const setAvatar = (value: string | null) =>
  request<{ user: AccountUser }>('PATCH', '/api/auth/me', { body: { avatarUrl: value } });

/** Signs out one other device. */
export const revokeSession = (id: string) =>
  request('DELETE', `/api/auth/sessions/${encodeURIComponent(id)}`);

/** Signs out every device but this one; resolves with how many it ended. */
export const revokeOtherSessions = () =>
  request<{ revoked: number }>('POST', '/api/auth/sessions/revoke-others');

/** Sets or changes the password; other devices are signed out. Resolves with how many. */
export const changePassword = (input: { currentPassword?: string; newPassword: string }) =>
  request<{ revoked: number }>('POST', '/api/auth/password', { body: input });

/** Uploads a (already shrunk) picture as raw bytes, like the desktop app does, and resolves with its id. */
export async function uploadAvatar(blob: Blob): Promise<string> {
  const response = await fetch('/api/avatars/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-VTT-Client': 'web', 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(
      String(data.error ?? 'error'),
      String(data.message ?? `upload failed (${response.status})`),
      response.status,
    );
  }
  return String(data.id);
}

// ---- Pure helpers ----

const UPLOADED = /^avatar:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The portrait to draw: an uploaded picture's same-origin address. Emblems (desktop-only) give none. */
export function avatarSrc(avatarUrl: string | null | undefined): string | undefined {
  const id = avatarUrl ? UPLOADED.exec(avatarUrl)?.[1] : undefined;
  return id ? `/api/avatars/${id}` : undefined;
}

/** True for a portrait the web page cannot draw (a built-in emblem set in the desktop app). */
export const isEmblem = (avatarUrl: string | null | undefined): boolean =>
  typeof avatarUrl === 'string' && avatarUrl.startsWith('emblem:');

/** What a device calls itself, or a stand-in. The text is the device's own: render it as text only. */
export const sessionLabel = (s: Pick<AccountSession, 'deviceLabel'>): string =>
  s.deviceLabel?.trim() || UNKNOWN_SESSION_LABEL;

/** This device first, then the others by most recent use. */
export function orderSessions(list: AccountSession[]): {
  current: AccountSession | undefined;
  others: AccountSession[];
} {
  return {
    current: list.find((s) => s.current),
    others: list.filter((s) => !s.current).sort((a, b) => b.lastSeenAt - a.lastSeenAt),
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", then the date. */
export function ago(at: number, now: number): string {
  const d = Math.max(0, now - at);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (d < MINUTE) return 'just now';
  if (d < HOUR) return plural(Math.floor(d / MINUTE), 'minute');
  if (d < DAY) return plural(Math.floor(d / HOUR), 'hour');
  if (d < 2 * DAY) return 'yesterday';
  if (d < 30 * DAY) return plural(Math.floor(d / DAY), 'day');
  return `on ${dateOf(at)}`;
}

/** `2026-11-13`, in the viewer's own time zone. */
export function dateOf(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The recording-notice line: what was accepted and when, or that nothing is on record. */
export function noticeLine(user: Pick<AccountUser, 'consentVersion' | 'consentAt'>): string {
  if (!user.consentVersion) return 'You have not accepted the recording notice yet.';
  return user.consentAt
    ? `You accepted version ${user.consentVersion} of the recording notice on ${dateOf(user.consentAt)}.`
    : `You accepted version ${user.consentVersion} of the recording notice.`;
}

/** A readable problem with the password form, or undefined when it can be sent. */
export function passwordProblem(input: {
  hasPassword: boolean;
  current: string;
  next: string;
  confirm: string;
}): string | undefined {
  if (input.hasPassword && input.current === '') return 'Enter your current password.';
  if (input.next.length < MIN_PASSWORD_LENGTH) {
    return `The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (input.next !== input.confirm) return 'The two new passwords do not match.';
  if (input.hasPassword && input.next === input.current) {
    return 'The new password is the same as the current one.';
  }
  return undefined;
}

/** The sentence after a password change: how many other devices were signed out. */
export function passwordDoneLine(revoked: number, hadPassword: boolean): string {
  const base = hadPassword ? 'Password changed.' : 'Password set.';
  if (revoked === 0) return base;
  return `${base} ${revoked} other ${revoked === 1 ? 'device was' : 'devices were'} signed out.`;
}

/**
 * The size a picture is cropped and scaled to: a centred square of its shorter side, drawn at
 * `ACCOUNT_AVATAR_PX` (never enlarged beyond the source).
 */
export function avatarCrop(
  width: number,
  height: number,
  target = ACCOUNT_AVATAR_PX,
): { sx: number; sy: number; side: number; out: number } {
  const side = Math.min(width, height);
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
    out: Math.max(1, Math.min(target, side)),
  };
}

/** Crops and shrinks a picked image to a small square (the server keeps portraits under 256 KB). */
export async function shrinkAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { sx, sy, side, out } = avatarCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    );
    if (!blob) throw new Error('could not encode the picture');
    return blob;
  } finally {
    bitmap.close();
  }
}
