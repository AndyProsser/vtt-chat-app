import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds a single self-contained IIFE script — `src-tauri` injects it directly into the DDB
// page via `initialization_script`, so there's no HTML shell to hang a <link>/<script> off of.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.tsx',
      name: 'VttChatOverlay',
      formats: ['iife'],
      fileName: () => 'overlay.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
