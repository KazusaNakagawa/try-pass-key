import { defineConfig } from 'vite';

export default defineConfig({
  // Keep Vite's cache in the shared node_modules volume, not in web/node_modules
  // (which would be created on the host through the bind mount).
  cacheDir: '../node_modules/.vite/web',
  server: {
    // Listen on all interfaces inside the container; compose publishes it on 127.0.0.1 only.
    host: true,
    port: 5173,
    strictPort: true,
    // Same-origin proxy: the browser only ever talks to http://localhost:5173,
    // so there is no CORS and the session cookie stays first-party.
    // changeOrigin is left off so the server sees the browser's Host header.
    proxy: {
      '/api': { target: process.env.API_TARGET ?? 'http://localhost:3000' },
    },
    // Docker on macOS may miss file change events on bind mounts (docs/01 K6).
    watch: { usePolling: process.env.VITE_USE_POLLING === 'true' },
  },
});
