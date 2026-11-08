import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

import { themeCss } from './src/lib/themes.js';

/**
 * Emits the theme tables as a real stylesheet. The app's CSP forbids inline and script-injected
 * styles (Tauri adds hashes to it, which makes `'unsafe-inline'` ineffective), and `'self'` files are
 * always allowed. Being a linked sheet it also blocks first paint, so there is no unstyled flash.
 */
function themeStylesheet(): Plugin {
  return {
    name: 'vtt-theme-stylesheet',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'themes.css', source: themeCss() });
    },
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'stylesheet', href: './themes.css' }, injectTo: 'head' },
    ],
  };
}

// An ordinary multi-file app build: `src-tauri` serves it as the app's own local pages
// (no injection, no remote content). Relative `base` so it loads from Tauri's asset protocol.
export default defineConfig({
  plugins: [react(), themeStylesheet()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
