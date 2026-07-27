import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve sibling workspaces from SOURCE (npm runs lifecycle scripts
      // alphabetically, not in dependency order).
      '@chestnutlabs/toolpath-core': fileURLToPath(new URL('../toolpath-core/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-colors': fileURLToPath(new URL('../gcode-colors/src/index.ts', import.meta.url)),
      '@chestnutlabs/gcode-parser': fileURLToPath(new URL('../gcode-parser/src/index.ts', import.meta.url)),
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
