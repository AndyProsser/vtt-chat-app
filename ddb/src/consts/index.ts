export const DDB_COBALT_COOKIE_NAME = 'CobaltSession';

export const DDB_COBALT_TOKEN_URL = 'https://auth-service.dndbeyond.com/v1/cobalt-token';

export const DDB_CHARACTER_LIST_URL =
  'https://character-service.dndbeyond.com/character/v5/characters/list';

export const DDB_CAMPAIGN_DETAILS_URL = 'https://api.dndbeyond.com/campaigns/v1/details';

/**
 * Safety margin subtracted from the cobalt JWT's real expiry before treating it as stale.
 * The token is ~5min-lived and undocumented in detail — re-exchange well before the edge
 * rather than risk a Character Service call failing mid-request. See DDB-AUTH.md.
 */
export const DDB_COBALT_TOKEN_REFRESH_MARGIN_MS = 60_000;
