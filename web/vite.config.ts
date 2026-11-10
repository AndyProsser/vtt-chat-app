import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the backend at /join/* (WEB_DIR=web/dist); assets under /assets. In dev, API calls go to
// the local backend.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Two pages share one asset folder: the invite page (index.html) and the phone app (app.html).
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html'), app: resolve(__dirname, 'app.html') },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000', '/ws': { target: 'ws://127.0.0.1:3000', ws: true } },
  },
  test: { include: ['src/**/*.test.ts'] },
});
