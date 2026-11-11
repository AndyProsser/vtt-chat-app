import type { AiSettings, ChatKind } from '@vtt-chat-app/shared';

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
  /** The person's own portrait (`avatar:<id>` or `emblem:<name>`), if they set one. */
  avatarUrl?: string | null;
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
  /** The DM's switch: while true the campaign is listed in the directory and takes join requests. */
  allowJoin: boolean;
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
  /** When the D&D Beyond link was last read successfully (epoch ms). */
  syncedAt: number | null;
  /** The D&D Beyond portrait address last imported; the portrait is only replaced when this changes. */
  sourceAvatar: string | null;
  /** At-a-glance numbers worked out from the D&D Beyond sheet (ability scores, max HP, AC, passive perception). */
  sheet: CharacterSheet | null;
}

/** Shared with the D&D Beyond reader; calculated by us, so the app labels them as such. */
export type CharacterSheet = import('@vtt-chat-app/ddb').DdbSheet;

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

export type MagicLinkPurpose = 'signin' | 'reset' | 'link';

export interface MagicLink {
  id: string;
  email: string;
  purpose: MagicLinkPurpose;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

/** A desktop app waiting for a signed-in browser to approve it (docs/architecture/APP-SIGN-IN.md). */
export interface DeviceRequest {
  id: string;
  /** Hash of the normalised user code the person types in the browser. */
  userCodeHash: string;
  /** Hash of the secret only the polling app knows. */
  pollSecretHash: string;
  deviceLabel: string | null;
  requestIp: string | null;
  createdAt: number;
  expiresAt: number;
  approvedUserId: string | null;
  deliveredAt: number | null;
}

/** One line of table chat. `recipientId` set = a whisper, private to sender and recipient. */
export interface ChatMessage {
  id: string;
  campaignId: string;
  senderId: string | null;
  senderName: string;
  recipientId: string | null;
  text: string;
  at: number;
  /** In character (`chat`, the default), `say`, `do`, or `ooc` (never recorded). Whispers are always `chat`. */
  kind: ChatKind;
  /** The language of a `say` line: a key from the shared language table. Only with kind `say`. */
  lang?: string;
}

export type CampaignCreation = 'closed' | 'open';

export type SignupRequestsSetting = 'on' | 'off';

export type CampaignDirectorySetting = 'on' | 'off';

export type JoinRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** Someone's ask to join a campaign; the campaign's current DM decides. */
export interface JoinRequest {
  id: string;
  campaignId: string;
  userId: string;
  /** Up to 280 characters, control and bidirectional characters stripped. */
  message: string;
  status: JoinRequestStatus;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
}

/** What the directory may show of a campaign: never a member's name beyond the DM's. */
export interface OpenCampaign {
  id: string;
  name: string;
  dmName: string;
  playerCount: number;
}

export type SignupRequestStatus = 'pending' | 'approved' | 'rejected';

/** A visitor's request for an account; the operator approves or rejects it in the Admin CLI. */
export interface SignupRequest {
  id: string;
  /** Normalised (trimmed, lowercase). */
  email: string;
  displayName: string;
  message: string;
  status: SignupRequestStatus;
  createdAt: number;
  decidedAt: number | null;
}

/** Instance-wide settings; the Admin and the CLI change them. */
export interface InstanceSettings {
  /** `closed`: only the Admin creates campaigns. `open`: anyone, including players. */
  campaignCreation: CampaignCreation;
  /** `on`: visitors may ask for an account (the operator approves in the CLI). Off by default. */
  signupRequests: SignupRequestsSetting;
  /** `on`: campaigns whose DM allows it are listed to every signed-in account. `off`: invites only. */
  campaignDirectory: CampaignDirectorySetting;
  /** A device unseen for this long must sign in again. */
  offlineLimitDays: number;
  inviteExpiryDays: number;
  /** The current "you may be recorded" text version; a change re-prompts at next sign-in. */
  consentVersion: string;
  /** Where Whisper and the LLM run, and what happens when a remote is unreachable. */
  ai: AiSettings;
}
