import { describe, expect, it } from 'vitest';

import { appPromoHref } from './promo.js';

describe('appPromoHref', () => {
  it('goes to the download page on a computer and the explainer on a phone or tablet', () => {
    expect(appPromoHref(false)).toBe('/download');
    expect(appPromoHref(true)).toBe('/full-app');
  });
});
