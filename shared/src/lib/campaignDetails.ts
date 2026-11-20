/** The same limits the server enforces (backend `consts`): the form says so before the server has to. */
export const CAMPAIGN_NAME_MAX = 120;
export const CAMPAIGN_DESCRIPTION_MAX = 4000;

/** Characters as a person counts them (an emoji is one), not UTF-16 units or bytes. */
export const characterCount = (text: string): number => [...text].length;

export type DetailsCheck = { ok: true } | { ok: false; message: string };

export function validateDetails(name: string, description: string): DetailsCheck {
  const length = characterCount(name.trim());
  if (length < 1 || length > CAMPAIGN_NAME_MAX) {
    return { ok: false, message: `The name must be 1–${CAMPAIGN_NAME_MAX} characters.` };
  }
  if (characterCount(description.trim()) > CAMPAIGN_DESCRIPTION_MAX) {
    return {
      ok: false,
      message: `The description can be at most ${CAMPAIGN_DESCRIPTION_MAX} characters.`,
    };
  }
  return { ok: true };
}
