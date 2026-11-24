/** The part of a Vite plugin this one needs, so ui-kit does not depend on Vite itself. */
export interface Woff2OnlyPlugin {
  name: string;
  enforce: 'pre';
  transform: (code: string, id: string) => string | null;
}

/**
 * Fontsource lists every face twice, as `.woff2` and as an older `.woff`, and Vite copies both into `dist/`. Every
 * browser and webview this app runs in reads WOFF2 (Chrome 36, Firefox 39, Safari 12; the app already needs far newer
 * ones, see web/public/old-browser.js), so the `.woff` copy is never downloaded and only doubles the build. This drops
 * it from Fontsource's own stylesheets before Vite follows the URLs, and touches nothing else.
 */
export function woff2Only(): Woff2OnlyPlugin {
  return {
    name: 'vtt-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.css(\?|$)/.test(id) || !id.includes('/@fontsource')) return null;
      return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, '');
    },
  };
}
