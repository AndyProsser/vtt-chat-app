import { DDB_CAMPAIGN_DETAILS_URL, DDB_CHARACTER_LIST_URL } from '../consts/index.js';
import type {
  DdbCampaignDetailsResponse,
  DdbCharacterListEntry,
  DdbCharacterListResponse,
} from '../types/index.js';

export class CharacterServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'CharacterServiceError';
  }
}

function authHeaders(jwt: string): Record<string, string> {
  return { Authorization: `Bearer ${jwt}` };
}

export async function fetchCharacterList(
  ddbUserId: string,
  jwt: string,
): Promise<DdbCharacterListEntry[]> {
  const url = new URL(DDB_CHARACTER_LIST_URL);
  url.searchParams.set('userId', ddbUserId);

  const response = await fetch(url, { headers: authHeaders(jwt) });
  if (!response.ok) {
    throw new CharacterServiceError(
      `character list request failed with status ${response.status}`,
      response.status,
    );
  }

  const body = (await response.json()) as DdbCharacterListResponse;
  return body.data.characters;
}

export async function fetchCampaignDetails(
  campaignId: number,
  jwt: string,
): Promise<DdbCampaignDetailsResponse['data']> {
  const response = await fetch(`${DDB_CAMPAIGN_DETAILS_URL}/${campaignId}`, {
    headers: authHeaders(jwt),
  });
  if (!response.ok) {
    throw new CharacterServiceError(
      `campaign details request failed with status ${response.status}`,
      response.status,
    );
  }

  const body = (await response.json()) as DdbCampaignDetailsResponse;
  return body.data;
}
