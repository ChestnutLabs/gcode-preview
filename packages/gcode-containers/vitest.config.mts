import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve sibling workspaces from SOURCE so tests never depend on dist
      // build order (npm runs workspace lifecycle scripts alphabetically).
      '@chestnutlabs/toolpath-core': fileURLToPath(new URL('../toolpath-core/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30000
  }
});
