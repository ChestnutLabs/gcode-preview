import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two-tier example (DD-031 §4.7): `minimal.html` is the smallest real integration; `showcase.html`
// exercises the full declarative capability surface and shares the workspace-internal demo-kit
// (../demo-kit) with the Feature Lab so the examples read as one project. Both import the REAL
// published @chestnutlabs/gcode-preview-react — never a raw renderer/session.
export default defineConfig({
  base: './',
  // Automatic JSX runtime without @vitejs/plugin-react (no HMR fast-refresh needed here).
  esbuild: { jsx: 'automatic' },
  // Serve the whole MIT demo corpus so demo-kit fixture paths (gcodes/…, fixtures/…) resolve.
  publicDir: '../../test-data',
  server: {
    port: 5201,
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
    dedupe: ['three', 'react', 'react-dom']
  },
  optimizeDeps: {
    // Serve the workspace packages as real ESM so Vite's `new Worker(new URL(...))`
    // handling applies inside @chestnutlabs/gcode-parser (linked-dev note in the README).
    exclude: [
      '@chestnutlabs/gcode-parser',
      '@chestnutlabs/toolpath-core',
      '@chestnutlabs/gcode-renderer-three',
      '@chestnutlabs/gcode-dialects',
      '@chestnutlabs/gcode-containers',
      '@chestnutlabs/gcode-preview-core',
      '@chestnutlabs/gcode-preview-react'
    ]
  }
});
