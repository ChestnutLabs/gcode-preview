// Shared vitest wiring for both svelte legs (issue #444). Each leg's vitest.config.mjs passes in its
// own `compiler` (so the transform runs the leg's svelte, never a hoisted one) and its own root.
import { fileURLToPath } from 'node:url';

const pkg = (p) => fileURLToPath(new URL(`../../../packages/${p}`, import.meta.url));

/** Sibling workspaces resolve from SOURCE, exactly like packages/gcode-preview-svelte/vitest.config.mts
 *  (no dist build needed). Subpath keys before package keys. */
const ALIASES = {
  '@chestnutlabs/gcode-preview-core/testing': pkg('gcode-preview-core/src/testing.ts'),
  '@chestnutlabs/gcode-preview-core': pkg('gcode-preview-core/src/index.ts'),
  '@chestnutlabs/toolpath-core': pkg('toolpath-core/src/index.ts'),
  '@chestnutlabs/gcode-containers': pkg('gcode-containers/src/index.ts'),
  '@chestnutlabs/gcode-model-renderer/testing': pkg('gcode-model-renderer/src/model-testing.ts'),
  '@chestnutlabs/gcode-model-renderer': pkg('gcode-model-renderer/src/index.ts'),
  '@chestnutlabs/gcode-colors': pkg('gcode-colors/src/index.ts'),
  '@chestnutlabs/gcode-renderer-2d': pkg('gcode-renderer-2d/src/index.ts'),
  '@chestnutlabs/gcode-parser': pkg('gcode-parser/src/index.ts'),
  '@chestnutlabs/gcode-renderer-three': pkg('gcode-renderer-three/src/index.ts')
};

/**
 * Compile `.svelte` (and, on Svelte 5, `.svelte.js` rune modules) with the leg's own compiler. Used
 * instead of @sveltejs/vite-plugin-svelte: that plugin pins the vite major per svelte major and drags
 * in a vite/vitest chain with unfixable advisories on the Svelte 4 leg. The harness only needs
 * `compile()` output; it does not need HMR, CSS extraction or the inspector.
 */
export function compileSvelte(compiler, major) {
  return {
    name: 'svelte-compat-compile',
    transform(code, id) {
      const file = id.split('?')[0];
      if (file.endsWith('.svelte')) {
        const out = compiler.compile(code, {
          filename: file,
          generate: major === 5 ? 'client' : 'dom',
          css: 'injected',
          dev: true
        });
        return { code: out.js.code, map: out.js.map };
      }
      if (major === 5 && /\.svelte\.[jt]s$/.test(file)) {
        const out = compiler.compileModule(code, { filename: file, generate: 'client' });
        return { code: out.js.code, map: out.js.map };
      }
      return null;
    }
  };
}

export function legConfig({ compiler, major }) {
  return {
    plugins: [compileSvelte(compiler, major)],
    resolve: {
      alias: ALIASES,
      // The components live under packages/, so a bare `import 'svelte'` there would otherwise walk up to
      // the ROOT node_modules (Svelte 5 via peer auto-install). Dedupe pins it to this leg's install;
      // compat.mjs asserts the result.
      dedupe: ['svelte'],
      // Svelte's client runtime sits behind the `browser` export condition.
      conditions: ['browser']
    },
    test: {
      include: ['*.test.mjs'],
      environment: 'happy-dom',
      globals: false
    }
  };
}
