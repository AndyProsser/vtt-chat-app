/** A single character as extracted from DDB's Character Service, scoped to one campaign. */
export interface DdbCharacterSummary {
  id: string;
  name: string;
  campaignId: string | null;
}

/** Campaign metadata from DDB, including the DM's DDB user id for DM-role derivation. */
export interface DdbCampaignSummary {
  id: string;
  name: string;
  dmUserId: string;
}

/**
 * Normalized identity handed from `ddb/` (client-side extraction) to `backend/`.
 * `isDm` is derived by comparing `ddbUserId` to `campaign.dmUserId`, not read from a single flag.
 */
export interface DdbIdentity {
  ddbUserId: string;
  selectedCharacter: DdbCharacterSummary;
  campaign: DdbCampaignSummary;
  isDm: boolean;
}
