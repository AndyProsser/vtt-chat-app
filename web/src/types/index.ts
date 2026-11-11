export type Platform = 'windows' | 'macos' | 'linux' | 'other';

export interface Downloads {
  windows?: string;
  macos?: string;
  linux?: string;
  /** Extra Linux formats, present when the server's update sync found them. */
  linuxDeb?: string;
  linuxRpm?: string;
}

/** `GET /api/invites/:code` */
export interface InvitePreview {
  campaignName: string;
  consentVersion: string;
}

export interface SignUpInput {
  email: string;
  displayName: string;
  password: string;
  consentVersion: string;
}
export * from './installGuide.js';
