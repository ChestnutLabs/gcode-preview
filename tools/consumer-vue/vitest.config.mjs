import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    environment: 'node',
    globals: false,
    // Everything resolves from the INSTALLED tarballs — no aliases, no workspace magic.
    testTimeout: 30000
  }
});
