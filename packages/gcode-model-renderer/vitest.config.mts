import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve sibling workspaces from SOURCE (CI's test:packages deletes non-core dists, and npm
      // runs lifecycle scripts alphabetically, not in dependency order). Include gcode-renderer-three's
      // own transitive deps, since resolving it from source pulls them in too.
      '@chestnutlabs/toolpath-core': fileURLToPath(new URL('../toolpath-core/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-colors': fileURLToPath(new URL('../gcode-colors/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-renderer-three': fileURLToPath(
        new URL('../gcode-renderer-three/src/index.ts', import.meta.url)
      )
    }
  },
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false
  }
});
