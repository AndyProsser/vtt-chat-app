import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.js';

// Merges into the existing Vite config (the IIFE build in vite.config.ts is untouched by this —
// `test` is a separate key `vite build` never reads) so Vitest resolves the same aliases/plugins
// the app build does.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      setupFiles: ['./vitest.setup.ts'],
    },
  }),
);
