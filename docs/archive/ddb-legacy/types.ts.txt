/**
 * Raw DDB API response shapes. These are internal — `ddb/`'s job is to normalize them into the
 * `shared/` types (`DdbIdentity` etc.) that the rest of the app consumes. Field names/nesting are
 * inferred from the archived `vtt-chat-extension` docs, not a captured live sample — verify against
 * real traffic during Stage 1 implementation (see docs/architecture/DDB-AUTH.md).
 */

export interface CobaltTokenResponse {
  token: string;
}

export interface DdbCharacterListEntry {
  id: number;
  name: string;
  campaignId: number | null;
}

export interface DdbCharacterListResponse {
  data: {
    characters: DdbCharacterListEntry[];
  };
}

export interface DdbCampaignDetailsResponse {
  data: {
    id: number;
    name: string;
    dmId: number;
  };
}
