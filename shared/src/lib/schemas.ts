import { z } from 'zod';

export const ddbCharacterSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  campaignId: z.string().min(1).nullable(),
});

export const ddbCampaignSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dmUserId: z.string().min(1),
});

export const ddbIdentitySchema = z.object({
  ddbUserId: z.string().min(1),
  selectedCharacter: ddbCharacterSummarySchema,
  campaign: ddbCampaignSummarySchema,
  isDm: z.boolean(),
});

/** Validates the `POST /api/session` request body — this is the trust boundary backend/ enforces. */
export const sessionRequestSchema = z.object({
  identity: ddbIdentitySchema,
});
