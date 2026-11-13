/** `GET /api/auth/me` → `user`: what the Account page shows. */
export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** The recording-notice version this person accepted, and when (ms since the epoch). */
  consentVersion: string;
  consentAt?: number;
  /** False for an account that only signs in by emailed code or an operator code. */
  hasPassword?: boolean;
}

/** `GET /api/auth/sessions` → one signed-in device. `deviceLabel` is text the device itself sent. */
export interface AccountSession {
  id: string;
  deviceLabel: string | null;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}
