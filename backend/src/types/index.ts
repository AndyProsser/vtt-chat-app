import type { AiSettings } from '@vtt-chat-app/shared';

/**
 * Domain types for accounts, campaigns and sessions. The shapes match
 * `backend/migrations/0001_init.sql`; the decisions behind them are in CLAUDE.md §11.
 * Timestamps are epoch milliseconds so tests can drive a fake clock.
 */

export interface User {
  id: string;
  /** Lower-cased. */
  email: string;
  displayName: string;
  /** `null` for accounts that only sign in by magic link or OIDC. */
  passwordHash: string | null;
  /** The first account on a fresh instance becomes Admin. */
  isAdmin: boolean;
  /** Which version of the "you may be recorded" text this person accepted, and when. */
  consentVersion: string;
  consentAt: number;
  createdAt: number;
}

export type Role = 'dm' | 'player';

export interface Campaign {
  id: string;
  name: string;
  createdAt: number;
}

/** Roles are per campaign: one account can be DM in one campaign and a player in another. */
export interface Membership {
  campaignId: string;
  userId: string;
  role: Role;
  /** The one character this player is currently using in this campaign. */
  activeCharacterId: string | null;
  /**
   * While someone is DM their active character is parked here, not deleted, so swapping back
   * restores it (one-shot campaigns rotate the DM every session).
   */
  suspendedCharacterId: string | null;
  joinedAt: number;
}

export interface Character {
  id: string;
  userId: string;
  campaignId: string;
  name: string;
  className: string | null;
  race: string | null;
  level: number | null;
  avatarUrl: string | null;
  /** The public D&D Beyond URL it was imported from, if any. */
  sourceUrl: string | null;
}

/** A long-lived, remotely revocable sign-in on one device. Only a hash of the secret is stored. */
export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  deviceLabel: string | null;
  createdAt: number;
  /** Updated by the client's periodic ping. */
  lastSeenAt: number;
  revokedAt: number | null;
}

/** One code the DM shares with the whole group: multi-use, but it expires. */
export interface Invite {
  id: string;
  campaignId: string;
  codeHash: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  uses: number;
  revokedAt: number | null;
}

export type MagicLinkPurpose = 'signin' | 'reset';

export interface MagicLink {
  id: string;
  email: string;
  purpose: MagicLinkPurpose;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export type CampaignCreation = 'closed' | 'open';

/** Instance-wide settings; the Admin and the CLI change them. */
export interface InstanceSettings {
  /** `closed`: only the Admin creates campaigns. `open`: anyone, including players. */
  campaignCreation: CampaignCreation;
  /** A device unseen for this long must sign in again. */
  offlineLimitDays: number;
  inviteExpiryDays: number;
  /** The current "you may be recorded" text version; a change re-prompts at next sign-in. */
  consentVersion: string;
  /** Where Whisper and the LLM run, and what happens when a remote is unreachable. */
  ai: AiSettings;
}
