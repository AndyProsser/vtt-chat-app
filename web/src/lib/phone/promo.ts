/** Where the header's "Get the app" button goes: the download page on a computer, the explainer on a phone or tablet. */
export const appPromoHref = (mobile: boolean): string => (mobile ? '/full-app' : '/download');
