/**
 * `/lite` is the three-free entry that a lazily-loading package (gcode-preview-core) imports statically.
 * It must stay three-free and stay a strict subset of the main entry.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as lite from '../lite.js';
import * as main from '../index.js';

const srcDir = fileURLToPath(new URL('../', import.meta.url));

/** Value (non-type) import/export specifiers of a source file. */
function valueSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/^(import|export)\s+(type\s+)?[^;]*?from\s*'([^']+)'/gms)) {
    if (m[2] === undefined) out.push(m[3]);
  }
  for (const m of source.matchAll(/^import\s+'([^']+)'/gm)) out.push(m[1]);
  return out;
}

/** Every module `entry` reaches through value imports, plus the external packages it names. */
function valueGraph(entry: string): { files: string[]; externals: string[] } {
  const files = new Set<string>();
  const externals = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of valueSpecifiers(readFileSync(srcDir + file, 'utf8'))) {
      if (spec.startsWith('./')) queue.push(spec.slice(2).replace(/\.js$/, '.ts'));
      else externals.add(spec);
    }
  }
  return { files: [...files].sort(), externals: [...externals].sort() };
}

describe('the ./lite entry', () => {
  it('exports exactly the three-free values core needs', () => {
    expect(Object.keys(lite).sort()).toEqual(['CaptureUnsupportedError', 'STUDIO_CAMERA_FOV', 'studioTheme']);
    expect(lite.STUDIO_CAMERA_FOV).toBe(32);
    expect(new lite.CaptureUnsupportedError('x')).toBeInstanceOf(Error);
  });

  it('is a strict subset of the main entry: the same bindings, so no existing import changes', () => {
    const m = main as Record<string, unknown>;
    for (const [name, value] of Object.entries(lite)) expect(m[name], name).toBe(value);
  });

  it('reaches no value import of three (or of any package) through its whole module graph', () => {
    const graph = valueGraph('lite.ts');
    expect(graph.files).toEqual(['capture.ts', 'lite.ts', 'theme.ts']);
    expect(graph.externals).toEqual([]);
  });

  it('the graph walker does see a value import of three (so the check above is not vacuous)', () => {
    expect(valueGraph('backdrop.ts').externals).toContain('three');
    expect(valueSpecifiers("import type { A } from 'three';\nimport { B } from 'three';")).toEqual(['three']);
  });
});
