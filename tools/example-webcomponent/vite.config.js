import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two-tier example (DD-031 §4.7): `minimal.html` is the smallest real integration; `showcase.html`
// exercises the full attribute/property/event surface and shares the workspace-internal demo-kit
// (../demo-kit) with the Feature Lab. Both import the REAL published @chestnutlabs/gcode-preview-element
// — no raw renderer/session. This is the framework-free adapter, so the app itself is vanilla JS.
export default defineConfig({
  base: './',
  // Serve the whole MIT demo corpus so demo-kit fixture paths (gcodes/…, fixtures/…) resolve.
  publicDir: '../../test-data',
  server: {
    port: 5204,
    strictPort: true,
    // Allow the shared demo-kit, which lives outside this app's root (tools/demo-kit).
    fs: { allow: ['../..'] }
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        minimal: resolve(import.meta.dirname, 'minimal.html'),
        showcase: resolve(import.meta.dirname, 'showcase.html')
      }
    }
  },
  resolve: {
    dedupe: ['three']
  },
  optimizeDeps: {
    exclude: [
      '@chestnutlabs/gcode-parser',
      '@chestnutlabs/toolpath-core',
      '@chestnutlabs/gcode-renderer-three',
      '@chestnutlabs/gcode-dialects',
      '@chestnutlabs/gcode-containers',
      '@chestnutlabs/gcode-preview-core',
      '@chestnutlabs/gcode-preview-element'
    ]
  }
});
