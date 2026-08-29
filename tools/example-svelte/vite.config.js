import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Two-tier example (DD-031 §4.7): `minimal.html` is the smallest real integration; `showcase.html`
// exercises the full declarative surface and shares the workspace-internal demo-kit (../demo-kit)
// with the Feature Lab. Both import the REAL published @chestnutlabs/gcode-preview-svelte.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  // Serve the whole MIT demo corpus so demo-kit fixture paths (gcodes/…, fixtures/…) resolve.
  publicDir: '../../test-data',
  server: {
    port: 5202,
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
    dedupe: ['three', 'svelte']
  },
  optimizeDeps: {
    exclude: [
      '@chestnutlabs/gcode-parser',
      '@chestnutlabs/toolpath-core',
      '@chestnutlabs/gcode-renderer-three',
      '@chestnutlabs/gcode-dialects',
      '@chestnutlabs/gcode-containers',
      '@chestnutlabs/gcode-preview-core',
      '@chestnutlabs/gcode-preview-svelte'
    ]
  }
});
