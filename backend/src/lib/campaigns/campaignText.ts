import { CAMPAIGN_DESCRIPTION_MAX, CAMPAIGN_NAME_MAX } from '../../consts/index.js';
import { DomainError } from '../errors.js';

// Controls (except newline and tab in a description), zero-width and direction marks, bidi overrides and
// isolates, and the byte-order mark: nothing a person typed on purpose, and some could make text render
// misleadingly. Same set as device labels (auth/deviceLabel.ts).
/* eslint-disable no-control-regex */
const NAME_UNSHOWABLE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
const TEXT_UNSHOWABLE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
/* eslint-enable no-control-regex */

/** A campaign name: one line, trimmed, 1 to `CAMPAIGN_NAME_MAX` characters. */
export function cleanCampaignName(raw: string): string {
  const name = raw.replace(NAME_UNSHOWABLE, ' ').replace(/\s+/g, ' ').trim();
  if ([...name].length < 1 || [...name].length > CAMPAIGN_NAME_MAX) {
    throw new DomainError(
      'invalid_input',
      `campaign name must be 1–${CAMPAIGN_NAME_MAX} characters`,
    );
  }
  return name;
}

/** A campaign description: markdown, trimmed, at most `CAMPAIGN_DESCRIPTION_MAX` characters (code points). */
export function cleanCampaignDescription(raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n').replace(TEXT_UNSHOWABLE, '').trim();
  if ([...text].length > CAMPAIGN_DESCRIPTION_MAX) {
    throw new DomainError(
      'invalid_input',
      `the description can be at most ${CAMPAIGN_DESCRIPTION_MAX} characters`,
    );
  }
  return text;
}
