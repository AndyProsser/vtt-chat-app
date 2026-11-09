/** The service the public character sheet itself calls; readable without a login when the sheet is public. */
export const CHARACTER_SERVICE_URL =
  'https://character-service.dndbeyond.com/character/v5/character';

/** Be honest about what is asking. */
export const USER_AGENT = 'vtt-chat-app character sync (self-hosted; contact: instance operator)';

export const REQUEST_TIMEOUT_MS = 10_000;

/** Portraits are only fetched from these hosts (and their subdomains). */
export const PORTRAIT_HOSTS = ['dndbeyond.com', 'cursecdn.com'];
