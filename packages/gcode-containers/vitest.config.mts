import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      // Resolve sibling workspaces from SOURCE so tests never depend on dist
      // build order (npm runs workspace lifecycle scripts alphabetically).
      {
        find: '@chestnutlabs/toolpath-core',
        replacement: fileURLToPath(new URL('../toolpath-core/src/index.ts', import.meta.url))
      },
      // fuzz/*.mjs imports '../dist/index.js' because the real fuzzer must load the built package. CI runs the
      // package suites before any dist exists, so the fuzz-corpus test reads that import from SOURCE instead.
      { find: /^\.\.\/dist\/index\.js$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) }
    ]
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30000
  }
});
