import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// An ordinary multi-file app build: `src-tauri` serves it as the app's own local pages
// (no injection, no remote content). Relative `base` so it loads from Tauri's asset protocol.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
