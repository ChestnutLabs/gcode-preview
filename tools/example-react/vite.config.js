import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Automatic JSX runtime without @vitejs/plugin-react (no HMR fast-refresh needed here).
  esbuild: { jsx: 'automatic' },
  // Serve the MIT demo corpus (inherited upstream, tracked in test-data/manifest.json).
  publicDir: '../../demo/gcodes',
  server: {
    port: 5201,
    strictPort: true
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
