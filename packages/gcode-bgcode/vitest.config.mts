import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve sibling workspaces from SOURCE (npm runs lifecycle scripts
      // alphabetically, not in dependency order).
      '@chestnutlabs/toolpath-core': fileURLToPath(new URL('../toolpath-core/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-containers': fileURLToPath(new URL('../gcode-containers/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
});
