export type Platform = 'windows' | 'macos' | 'linux' | 'other';

export interface Downloads {
  windows?: string;
  /** Apple silicon (M1 and later). */
  macos?: string;
  /** Intel Macs, when the release has one. */
  macosIntel?: string;
  linux?: string;
  /** Extra Linux formats, present when the server's update sync found them. */
  linuxDeb?: string;
  linuxRpm?: string;
}

/** `GET /api/invites/:code` */
export interface InvitePreview {
  campaignName: string;
  consentVersion: string;
  /** The DM's markdown description; empty when there is none. */
  description: string;
  /** The DM's display name, or null while there is no DM. */
  dmName: string | null;
  /** Players in the campaign, not counting the DM. */
  playerCount: number;
}

export interface SignUpInput {
  email: string;
  displayName: string;
  password: string;
  consentVersion: string;
}
export * from './installGuide.js';
export * from './account.js';
