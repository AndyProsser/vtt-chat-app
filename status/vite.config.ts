import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served by the backend at /status (STATUS_DIR=status/dist). In dev, the API is the local backend.
export default defineConfig({
  plugins: [react()],
  base: '/status/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  test: { include: ['src/**/*.test.ts'] },
});
