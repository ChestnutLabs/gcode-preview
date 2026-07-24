/**
 * DD-002 §5 dependency guardrails (#37):
 * - toolpath-core has zero runtime dependencies (no three/DOM/Vue/AnyBridge);
 * - its internal module graph is acyclic;
 * - its public export surface is explicit and snapshot-guarded.
 *
 * (The eslint no-restricted-imports overrides enforce forbidden specifiers at lint
 * time; the package tsconfig `lib: ["ES2022"]` rejects DOM usage at typecheck time.
 * These tests are the belt-and-braces runtime check.)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../index';

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = join(pkgRoot, 'src');

describe('package boundaries (DD-002 §5)', () => {
  it('declares zero runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it('has no forbidden import specifiers in source', () => {
    const forbidden = /from\s+['"](three|vue|lil-gui|@chestnutlabs\/gcode-|[^'"]*anybridge)[^'"]*['"]/i;
    for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(srcDir, file), 'utf8');
      expect(forbidden.test(text), `${file} imports a forbidden module`).toBe(false);
    }
  });

  it('has an acyclic internal module graph', () => {
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    const graph = new Map<string, string[]>();
    for (const file of files) {
      const name = file.replace(/\.ts$/, '');
      const text = readFileSync(join(srcDir, file), 'utf8');
      const deps = [...text.matchAll(/from\s+['"]\.\/([\w-]+)(?:\.js)?['"]/g)].map((m) => m[1]);
      graph.set(name, deps);
    }
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (node: string, trail: string[]): void => {
      if (done.has(node)) return;
      expect(visiting.has(node), `import cycle: ${[...trail, node].join(' -> ')}`).toBe(false);
      visiting.add(node);
      for (const dep of graph.get(node) ?? []) visit(dep, [...trail, node]);
      visiting.delete(node);
      done.add(node);
    };
    for (const node of graph.keys()) visit(node, []);
  });

  it('exposes exactly the documented public surface', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DEFAULT_STALE_AFTER_MS',
      'FeatureRole',
      'IR_SCHEMA_VERSION',
      'MAX_PROGRESS_NOTES',
      'MoveKind',
      'PROGRESS_OBSERVATION_VERSION',
      'ToolpathIRBuilder',
      'buildSourceIndex',
      'computeSegmentBounds',
      'createProgressMapper',
      'emptyBounds',
      'segmentAtByte'
    ]);
  });
});
