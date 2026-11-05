import type { DdbIdentity } from '@vtt-chat-app/shared';

import { fetchCampaignDetails, fetchCharacterList } from './characterService.js';
import { exchangeCobaltToken } from './cobalt.js';

export class IdentityExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityExtractionError';
  }
}

/**
 * End-to-end identity extraction: cobalt cookie -> DDB JWT -> character list -> campaign details.
 * Picks the first character that has a campaign assigned, since Stage 1 has no character-selection
 * UI yet — revisit once `overlay-ui` needs to support users with characters in multiple campaigns.
 */
export async function extractDdbIdentity(cobaltCookieValue: string): Promise<DdbIdentity> {
  const cobaltToken = await exchangeCobaltToken(cobaltCookieValue);
  const characters = await fetchCharacterList(cobaltToken.ddbUserId, cobaltToken.jwt);

  const selected = characters.find((character) => character.campaignId !== null);
  if (!selected || selected.campaignId === null) {
    throw new IdentityExtractionError(
      'no character with an assigned campaign found for this DDB user',
    );
  }

  const campaign = await fetchCampaignDetails(selected.campaignId, cobaltToken.jwt);

  return {
    ddbUserId: cobaltToken.ddbUserId,
    selectedCharacter: {
      id: String(selected.id),
      name: selected.name,
      campaignId: String(selected.campaignId),
    },
    campaign: {
      id: String(campaign.id),
      name: campaign.name,
      dmUserId: String(campaign.dmId),
    },
    isDm: String(campaign.dmId) === cobaltToken.ddbUserId,
  };
}
