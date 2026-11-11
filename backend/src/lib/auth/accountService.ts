import { randomUUID } from 'node:crypto';

import {
  DAY_MS,
  LINK_CODE_TTL_MINUTES,
  MAGIC_LINK_TTL_MINUTES,
  MIN_PASSWORD_LENGTH,
  MINUTE_MS,
} from '../../consts/index.js';
import type { MagicLinkPurpose, Session, User } from '../../types/index.js';
import { OWN_AVATAR_VALUE } from '../avatarValue.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import {
  equalHashes,
  generateSecret,
  generateShortCode,
  hashPassword,
  hashSecret,
  looksLikeShortCode,
  normaliseShortCode,
  verifyPassword,
} from './crypto.js';
import { cleanDeviceLabel } from './deviceLabel.js';

export interface Clock {
  now(): number;
}

export interface AccountDeps {
  store: Store;
  clock?: Clock;
  newId?: () => string;
}

export interface SignedIn {
  user: User;
  /** The device's credential: shown to the client once, never stored in the clear. */
  sessionToken: string;
  /** True if the person must accept the current consent text before continuing. */
  needsConsent: boolean;
}

export interface RegisterInput {
  email: string;
  displayName: string;
  /** Omit for an account that signs in only by magic link. */
  password?: string;
  /** The consent-text version shown to and accepted by the person. Must be the current one. */
  acceptedConsentVersion: string;
}

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError(
      'invalid_input',
      `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/** Accounts, sign-in and the long-lived, remotely revocable sessions that follow. */
export class AccountService {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(deps: AccountDeps) {
    this.store = deps.store;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.newId = deps.newId ?? randomUUID;
  }

  /**
   * Creates an account. The **first** account on a fresh instance becomes Admin. Consent to be
   * recorded is collected here and stored with the text version, so a later change to the text can
   * re-prompt (CLAUDE.md §8.4).
   */
  async register(input: RegisterInput): Promise<User> {
    const email = normaliseEmail(input.email);
    const displayName = input.displayName.trim();
    if (!validEmail(email)) throw new DomainError('invalid_input', 'invalid email address');
    if (displayName.length === 0 || displayName.length > 80) {
      throw new DomainError('invalid_input', 'display name must be 1–80 characters');
    }
    if (input.password !== undefined) checkPassword(input.password);

    const settings = await this.store.getSettings();
    if (input.acceptedConsentVersion !== settings.consentVersion) {
      throw new DomainError(
        'consent_required',
        'the current recording-consent text must be accepted',
      );
    }
    if (await this.store.getUserByEmail(email)) throw new DomainError('email_taken');

    const now = this.clock.now();
    const user: User = {
      id: this.newId(),
      email,
      displayName,
      passwordHash: input.password === undefined ? null : await hashPassword(input.password),
      isAdmin: (await this.store.countUsers()) === 0,
      consentVersion: settings.consentVersion,
      consentAt: now,
      createdAt: now,
    };
    await this.store.putUser(user);
    return user;
  }

  /**
   * Changes what other people see: the name (same rules as registration: not blank, at most 80
   * characters) and/or the portrait (an uploaded picture or emblem, or `null` to clear it). A field
   * that is not given is left alone.
   */
  async updateProfile(
    userId: string,
    changes: { displayName?: string; avatarUrl?: string | null },
  ): Promise<User> {
    const user = await this.requireUser(userId);
    const next = { ...user };
    if (changes.displayName !== undefined) {
      const name = changes.displayName.trim();
      if (name.length === 0 || name.length > 80) {
        throw new DomainError('invalid_input', 'a name is required (at most 80 characters)');
      }
      next.displayName = name;
    }
    if (changes.avatarUrl !== undefined) {
      const url = changes.avatarUrl;
      if (url !== null && url !== '' && !OWN_AVATAR_VALUE.test(url)) {
        throw new DomainError(
          'invalid_input',
          'the portrait must be an uploaded picture or an emblem',
        );
      }
      next.avatarUrl = url === null || url === '' ? null : url;
    }
    await this.store.putUser(next);
    return next;
  }

  /** Records that an existing user accepted the current consent text (after the text changed). */
  async acceptConsent(userId: string, version: string): Promise<User> {
    const settings = await this.store.getSettings();
    if (version !== settings.consentVersion) {
      throw new DomainError('consent_required', 'that is not the current consent text');
    }
    const user = await this.requireUser(userId);
    const updated = { ...user, consentVersion: version, consentAt: this.clock.now() };
    await this.store.putUser(updated);
    return updated;
  }

  async signInWithPassword(
    email: string,
    password: string,
    deviceLabel?: string,
  ): Promise<SignedIn> {
    const user = await this.store.getUserByEmail(normaliseEmail(email));
    // Always do the expensive hash work, so response time doesn't reveal whether the account exists.
    const ok = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyPassword(password, DUMMY_HASH), false);
    if (!user || !ok) throw new DomainError('invalid_credentials');
    return this.signInUser(user, deviceLabel);
  }

  /**
   * Issues a one-time sign-in or password-reset token. Returns `undefined` for an unknown address;
   * callers must answer "if that account exists, we sent a link" either way so the endpoint can't
   * be used to discover who has an account. The caller delivers the token: by email when SMTP is
   * configured, otherwise the DM/operator reads it out (CLI) and passes it on a side channel.
   */
  async requestMagicLink(
    email: string,
    purpose: MagicLinkPurpose,
  ): Promise<{ token: string; expiresAt: number } | undefined> {
    const normalised = normaliseEmail(email);
    if (!(await this.store.getUserByEmail(normalised))) return undefined;

    const token = generateSecret();
    const now = this.clock.now();
    const expiresAt = now + MAGIC_LINK_TTL_MINUTES * MINUTE_MS;
    await this.store.putMagicLink({
      id: this.newId(),
      email: normalised,
      purpose,
      tokenHash: hashSecret(token),
      createdAt: now,
      expiresAt,
      usedAt: null,
    });
    return { token, expiresAt };
  }

  /**
   * Issues a short-lived code for a user who is already signed in (on the web), to be typed or
   * scanned into the desktop app. Returned as 8 raw characters; callers format it for display.
   * Redeemed through `redeemMagicLink`, so it is single-use and stored only as a hash.
   */
  async issueLinkCode(userId: string): Promise<{ code: string; expiresAt: number }> {
    const user = await this.store.getUser(userId);
    if (!user) throw new DomainError('invalid_input', 'unknown user');
    await this.requireCurrentConsent(user);
    const code = generateShortCode();
    const now = this.clock.now();
    const expiresAt = now + LINK_CODE_TTL_MINUTES * MINUTE_MS;
    await this.store.putMagicLink({
      id: this.newId(),
      email: user.email,
      purpose: 'link',
      tokenHash: hashSecret(code),
      createdAt: now,
      expiresAt,
      usedAt: null,
    });
    return { code, expiresAt };
  }

  /** Redeems a magic link exactly once. A reset also sets a new password and signs out everywhere else. */
  async redeemMagicLink(
    token: string,
    options: { newPassword?: string; deviceLabel?: string } = {},
  ): Promise<SignedIn> {
    const link = await this.store.getMagicLinkByHash(
      hashSecret(looksLikeShortCode(token) ? normaliseShortCode(token) : token),
    );
    const now = this.clock.now();
    if (!link || link.usedAt !== null || link.expiresAt <= now) {
      throw new DomainError('invalid_token');
    }
    if (link.purpose === 'reset') {
      if (options.newPassword === undefined) {
        throw new DomainError('invalid_input', 'a reset needs a new password');
      }
      checkPassword(options.newPassword);
    }

    const user = await this.store.getUserByEmail(link.email);
    if (!user) throw new DomainError('invalid_token');

    await this.store.putMagicLink({ ...link, usedAt: now });
    let current = user;
    if (link.purpose === 'reset' && options.newPassword !== undefined) {
      current = { ...user, passwordHash: await hashPassword(options.newPassword) };
      await this.store.putUser(current);
      await this.revokeAllSessions(user.id);
    }
    return this.signInUser(current, options.deviceLabel);
  }

  /**
   * Checks a session token. Fails if it is unknown, revoked, or the device has been silent longer
   * than the offline limit. With `ping`, a valid check also records "seen now" — the client's
   * periodic ping — which is what keeps a regularly-used device signed in indefinitely.
   */
  async authenticate(
    sessionToken: string,
    options: { ping?: boolean } = {},
  ): Promise<{ user: User; session: Session }> {
    const [sessionId, secret] = sessionToken.split('.');
    if (!sessionId || !secret) throw new DomainError('session_invalid');

    const session = await this.store.getSession(sessionId);
    if (
      !session ||
      session.revokedAt !== null ||
      !equalHashes(session.tokenHash, hashSecret(secret))
    ) {
      throw new DomainError('session_invalid');
    }

    const settings = await this.store.getSettings();
    const now = this.clock.now();
    if (now - session.lastSeenAt > settings.offlineLimitDays * DAY_MS) {
      throw new DomainError('session_invalid', 'signed out after being offline too long');
    }

    const user = await this.store.getUser(session.userId);
    if (!user) throw new DomainError('session_invalid');

    if (options.ping) {
      const touched = { ...session, lastSeenAt: now };
      await this.store.putSession(touched);
      return { user, session: touched };
    }
    return { user, session };
  }

  async listSessions(userId: string): Promise<Session[]> {
    return (await this.store.listSessionsForUser(userId)).filter((s) => s.revokedAt === null);
  }

  /** Remote sign-out of one device. Only the owner may revoke their own session. */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.store.getSession(sessionId);
    if (!session || session.userId !== userId) throw new DomainError('not_found');
    if (session.revokedAt === null) {
      await this.store.putSession({ ...session, revokedAt: this.clock.now() });
    }
  }

  async revokeAllSessions(userId: string): Promise<void> {
    const now = this.clock.now();
    for (const session of await this.store.listSessionsForUser(userId)) {
      if (session.revokedAt === null) await this.store.putSession({ ...session, revokedAt: now });
    }
  }

  /** Whether `user` still has to accept the current recording notice (it changed, or never accepted). */
  async needsConsent(user: User): Promise<boolean> {
    const settings = await this.store.getSettings();
    return user.consentVersion !== settings.consentVersion;
  }

  /**
   * Refuses (`consent_required`) to hand a session to another device for a user who has not accepted
   * the current notice: the app has no consent screen, so the browser must take it first.
   */
  async requireCurrentConsent(user: User): Promise<void> {
    if (await this.needsConsent(user)) {
      throw new DomainError(
        'consent_required',
        'the recording notice has changed — accept it on this page before connecting the app',
      );
    }
  }

  /** Starts a session for a user who has already proved who they are (e.g. a device request approved in a browser). */
  async signInUser(user: User, deviceLabel?: string): Promise<SignedIn> {
    const secret = generateSecret();
    const now = this.clock.now();
    const session: Session = {
      id: this.newId(),
      userId: user.id,
      tokenHash: hashSecret(secret),
      deviceLabel: cleanDeviceLabel(deviceLabel) ?? null,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };
    await this.store.putSession(session);
    return {
      user,
      sessionToken: `${session.id}.${secret}`,
      needsConsent: await this.needsConsent(user),
    };
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.store.getUser(userId);
    if (!user) throw new DomainError('not_found');
    return user;
  }
}

/** A well-formed hash of nothing in particular, used to equalise timing for unknown accounts. */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
