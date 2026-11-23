import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep the Vitest cache in the shared node_modules volume, not in
  // server/node_modules (which would be created on the host through the bind mount).
  cacheDir: '../node_modules/.vite/server',
});
