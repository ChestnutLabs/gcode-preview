import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  // Serve the tracked test-data tree (MIT corpus at /gcodes/*, container fixtures at
  // /fixtures/**) without copying files into this app.
  publicDir: '../../test-data',
  build: {
    // Multi-page: the Feature Lab (index) is the flagship; the sibling pages the Feature Lab links
    // (RELATED_DEMOS) build too so the static Pages deploy has no dangling links.
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        'model-viewer': resolve(import.meta.dirname, 'model-viewer.html'),
        '2d': resolve(import.meta.dirname, '2d.html'),
        model: resolve(import.meta.dirname, 'model.html'),
        still: resolve(import.meta.dirname, 'still.html'),
        validate: resolve(import.meta.dirname, 'validate.html')
      }
    }
  },
  server: {
    port: 5199,
    strictPort: true,
    // Allow importing the workspace-internal demo-kit (tools/demo-kit) which lives outside this app's root.
    fs: { allow: ['../..'] }
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
