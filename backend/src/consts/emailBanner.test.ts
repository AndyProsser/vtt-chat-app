import { describe, expect, it } from 'vitest';

import { EMAIL_BANNER_CID, EMAIL_BANNER_JPEG_BASE64 } from './emailBanner.js';

describe('email banner', () => {
  const bytes = Buffer.from(EMAIL_BANNER_JPEG_BASE64, 'base64');

  it('is a small JPEG', () => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.length).toBeLessThanOrEqual(40_000);
  });

  it('has the content id the email HTML refers to', () => {
    expect(EMAIL_BANNER_CID).toBe('vtt-banner');
  });
});
