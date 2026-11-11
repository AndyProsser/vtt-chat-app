/** The last campaign, kept in this browser only (the session itself is a cookie, never stored by script). Storage can be blocked, so every call is guarded. */
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
    /* private mode or blocked: the person picks the campaign again next time */
  }
}

export const savedCampaign = () => read(CAMPAIGN);
export const saveCampaign = (id: string | undefined) => write(CAMPAIGN, id);

/** Earlier builds kept the session token here; the session is a cookie now, so drop any leftover. */
export const forgetLegacyToken = () => write('vtt.phone.token', undefined);
