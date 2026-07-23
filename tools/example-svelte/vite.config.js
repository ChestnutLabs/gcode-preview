import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  // Serve the MIT demo corpus (inherited upstream, tracked in test-data/manifest.json).
  publicDir: '../../demo/gcodes',
  server: {
    port: 5202,
    strictPort: true
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
