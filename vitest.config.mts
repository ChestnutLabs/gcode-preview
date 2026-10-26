import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.ts', 'tools/*.test.mjs'],
    environment: 'happy-dom',
    globals: true
  }
});
