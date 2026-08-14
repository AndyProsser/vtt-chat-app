import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds a single self-contained IIFE script — `src-tauri` injects it directly into the DDB
// page via `initialization_script`, so there's no HTML shell to hang a <link>/<script> off of.
export default defineConfig({
  plugins: [react()],
  // React's own bundled CJS entry point (`react-dom`'s dev/prod selector, `checkDCE`,
  // `__REACT_DEVTOOLS_GLOBAL_HOOK__`) branches on a literal `process.env.NODE_ENV` at module
  // load time. Vite replaces that automatically for a normal app build, but not for `build.lib`
  // — without this, the reference survives verbatim into the IIFE output, and since real
  // browsers (and WebKitGTK) never define a global `process`, evaluating the bundle throws
  // `ReferenceError: process is not defined` immediately, before `mount()` ever runs. Confirmed
  // 2026-08-14: the overlay never appeared in a real WebView session (`#vtt-chat-overlay-host`
  // was never in the DOM), reproduced by executing the built dist/overlay.js in a bare jsdom
  // document with no Node-specific globals.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
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
