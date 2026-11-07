export type Platform = 'windows' | 'macos' | 'linux' | 'other';

export interface Downloads {
  windows?: string;
  macos?: string;
  linux?: string;
}

/** `GET /api/invites/:code` */
export interface InvitePreview {
  campaignName: string;
  consentVersion: string;
  downloads: Downloads;
}

export interface SignUpInput {
  email: string;
  displayName: string;
  password: string;
  consentVersion: string;
}
