import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Serve the tracked test-data tree (MIT corpus at /gcodes/*, container fixtures at
  // /fixtures/**) without copying files into this app.
  publicDir: '../../test-data',
  server: {
    port: 5199,
    strictPort: true
  },
  resolve: {
    // One three.js instance even though the renderer package is symlinked.
    dedupe: ['three']
  },
  optimizeDeps: {
    // Serve the workspace packages as real ESM so Vite's `new Worker(new URL(...))`
    // handling applies inside @chestnutlabs/gcode-parser (same as the consumer smoke).
    exclude: [
      '@chestnutlabs/gcode-parser',
      '@chestnutlabs/toolpath-core',
      '@chestnutlabs/gcode-renderer-three',
      '@chestnutlabs/gcode-colors',
      '@chestnutlabs/gcode-renderer-2d',
      '@chestnutlabs/gcode-dialects',
      '@chestnutlabs/gcode-containers',
      '@chestnutlabs/gcode-preview-vue',
      '@chestnutlabs/gcode-preview-core'
    ]
  }
});
