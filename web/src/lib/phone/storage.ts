/** The signed-in token and last campaign, kept in this browser only. Storage can be blocked, so every call is guarded. */
const TOKEN = 'vtt.phone.token';
const CAMPAIGN = 'vtt.phone.campaign';

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function write(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked: the person signs in again next time */
  }
}

export const savedToken = () => read(TOKEN);
export const saveToken = (token: string | undefined) => write(TOKEN, token);
export const savedCampaign = () => read(CAMPAIGN);
export const saveCampaign = (id: string | undefined) => write(CAMPAIGN, id);
