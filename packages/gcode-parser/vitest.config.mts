import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the sibling workspace from SOURCE so tests/typecheck never depend on
      // its dist being built first (npm runs workspace lifecycle scripts in
      // alphabetical order, not dependency order).
      '@chestnutlabs/toolpath-core': fileURLToPath(new URL('../toolpath-core/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-dialects': fileURLToPath(new URL('../gcode-dialects/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-containers': fileURLToPath(new URL('../gcode-containers/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-bgcode': fileURLToPath(new URL('../gcode-bgcode/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30000
  }
});
