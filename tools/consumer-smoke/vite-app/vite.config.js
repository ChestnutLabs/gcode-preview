import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built app also loads under Electron's local server.
  base: './',
  optimizeDeps: {
    // Serve the workspace packages as real ESM so Vite's `new Worker(new URL(...))`
    // handling applies inside @chestnutlabs/gcode-parser (esbuild pre-bundling
    // would bypass the worker-URL transform).
    exclude: ['@chestnutlabs/gcode-parser', '@chestnutlabs/toolpath-core', '@chestnutlabs/gcode-dialects']
  }
});
