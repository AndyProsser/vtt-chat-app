import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the backend at /join/* (WEB_DIR=web/dist); assets under /assets. In dev, API calls go to
// the local backend.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  test: { include: ['src/**/*.test.ts'] },
});
