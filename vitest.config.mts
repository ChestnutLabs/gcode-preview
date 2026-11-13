import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.ts', 'tools/*.test.mjs', 'tools/release/*.test.mjs'],
    environment: 'happy-dom',
    globals: true
  }
});
