/**
 * DD-014 D4: the 3D renderer is loaded on demand, so nothing on the core/adapter startup path may
 * value-import the renderer's MAIN entry (one such import put all of three.js in every 2D bundle from
 * v0.18.0 to v0.23.0). Type imports are erased; three-free values come from `/lite`.
 * This source scan runs in the root test pass (no build needed); `tools/bundle-check.mjs` measures real bundles.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// path.resolve, not new URL(): the root suite runs under happy-dom, whose URL is not file-scheme aware.
const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages');

/** Every startup-path source file: core and the four adapters' main entries (not tests, not `/model`). */
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__' && name !== 'model') out.push(...sourceFiles(full));
    } else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The statements that load the renderer's main entry at startup: a value (non-type) import/export, a
 * side-effect `import '...'`, and an `import()` at module top level (column 0, so an eager load, not one
 * inside a function). An indented `import()` is the on-demand 3D load and is allowed.
 */
function mainEntryValueImports(source) {
  const statements =
    source.match(/^[ \t]*(?:import|export)\b[^;]*?from\s*['"]@chestnutlabs\/gcode-renderer-three['"]/gms) ?? [];
  const sideEffect = source.match(/^[ \t]*import\s*['"]@chestnutlabs\/gcode-renderer-three['"]/gm) ?? [];
  const eager = source.match(/^\S.*\bimport\(\s*['"]@chestnutlabs\/gcode-renderer-three['"]\s*\)/gm) ?? [];
  return [...statements.filter((s) => !/^\s*(?:import|export)\s+type\b/.test(s)), ...sideEffect, ...eager];
}

describe('three-free startup imports (DD-014 D4)', () => {
  it('the scanner flags a value import and allows type imports and /lite', () => {
    expect(
      mainEntryValueImports("import { ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';")
    ).toHaveLength(1);
    expect(mainEntryValueImports("export { studioTheme } from '@chestnutlabs/gcode-renderer-three';")).toHaveLength(1);
    expect(mainEntryValueImports("import type { Theme } from '@chestnutlabs/gcode-renderer-three';")).toEqual([]);
    expect(mainEntryValueImports("export type { Theme } from '@chestnutlabs/gcode-renderer-three';")).toEqual([]);
    expect(mainEntryValueImports("import { studioTheme } from '@chestnutlabs/gcode-renderer-three/lite';")).toEqual([]);
    // The on-demand load inside a function is allowed; the same import() at module top level is eager.
    expect(mainEntryValueImports("  const m = await import('@chestnutlabs/gcode-renderer-three');")).toEqual([]);
    expect(mainEntryValueImports("void import('@chestnutlabs/gcode-renderer-three');")).toHaveLength(1);
    expect(mainEntryValueImports("const m = await import('@chestnutlabs/gcode-renderer-three');")).toHaveLength(1);
    // A side-effect import loads the whole entry too.
    expect(mainEntryValueImports("import '@chestnutlabs/gcode-renderer-three';")).toHaveLength(1);
    expect(mainEntryValueImports('  import "@chestnutlabs/gcode-renderer-three";')).toHaveLength(1);
    expect(mainEntryValueImports("import '@chestnutlabs/gcode-renderer-three/lite';")).toEqual([]);
    // An indented one (a .svelte <script>) is caught too.
    expect(mainEntryValueImports("  import { studioTheme } from '@chestnutlabs/gcode-renderer-three';")).toHaveLength(
      1
    );
    // A multi-line value import is caught too.
    expect(
      mainEntryValueImports(
        "import {\n  CaptureUnsupportedError,\n  type Theme\n} from '@chestnutlabs/gcode-renderer-three';"
      )
    ).toHaveLength(1);
  });

  it.each([
    'gcode-preview-core',
    'gcode-preview-react',
    'gcode-preview-vue',
    'gcode-preview-svelte',
    'gcode-preview-element'
  ])('%s value-imports only /lite from the renderer, never its main entry', (pkg) => {
    const hits = sourceFiles(join(packagesDir, pkg, 'src')).flatMap((f) =>
      mainEntryValueImports(readFileSync(f, 'utf8')).map((s) => `${f}: ${s.split('\n')[0]}`)
    );
    expect(hits).toEqual([]);
  });
});
