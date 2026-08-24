import { describe, it, expect } from 'vitest';
import { Color } from 'three';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { parseStl } from '../stl.js';
import { ModelParseError } from '../limits.js';
import { renderModelStill } from '../render-model-still.js';
import { ModelRenderer } from '../model-renderer.js';
import { computeCacheKey } from '../cache-key.js';
import type { ModelScene } from '../scene-model.js';

type Tri = [number[], number[], number[]];

/** Minimal binary STL (80-byte header, uint32 count, 50 bytes/triangle). */
function makeBinaryStl(tris: Tri[]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    o += 12; // zero normal
    for (const v of t) {
      dv.setFloat32(o, v[0], true);
      dv.setFloat32(o + 4, v[1], true);
      dv.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    o += 2; // attribute byte count
  }
  return new Uint8Array(buf);
}

const TWO_TRIS: Tri[] = [
  [
    [0, 0, 0],
    [10, 0, 0],
    [0, 20, 0]
  ],
  [
    [0, 0, 0],
    [0, 0, 3.4],
    [10, 20, 3.4]
  ]
];

const ASCII_STL = `solid t
facet normal 0 0 0
 outer loop
  vertex 0 0 0
  vertex 10 0 0
  vertex 0 20 0
 endloop
endfacet
endsolid t`;

function stubCanvas(width = 256, height = 256): RenderTargetCanvas {
  return { width, height } as unknown as RenderTargetCanvas;
}
function stubGL(canvas: RenderTargetCanvas): GLRendererLike {
  return { render: () => undefined, setSize: () => undefined, dispose: () => undefined, domElement: canvas };
}

describe('parseStl', () => {
  it('binary STL → single honest object with correct bounds', () => {
    const scene = parseStl(makeBinaryStl(TWO_TRIS));
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0].id).toBe('stl');
    expect(scene.objects[0].geometry.positions).toHaveLength(2 * 3 * 3);
    expect(scene.bounds.min).toEqual([0, 0, 0]);
    expect(scene.bounds.max[0]).toBeCloseTo(10);
    expect(scene.bounds.max[1]).toBeCloseTo(20);
    expect(scene.bounds.max[2]).toBeCloseTo(3.4);
    // Honesty: STL carries no color / structure.
    expect(scene.capabilities).toEqual({
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable'
    });
    expect(scene.objects[0].material).toBeUndefined();
  });

  it('ASCII STL parses too', () => {
    const scene = parseStl(new TextEncoder().encode(ASCII_STL));
    expect(scene.objects[0].geometry.positions).toHaveLength(1 * 3 * 3);
    expect(scene.bounds.max[1]).toBeCloseTo(20);
  });

  it('rejects empty, oversize, and over-triangle inputs with structured errors', () => {
    const codeOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return e instanceof ModelParseError ? e.code : `not-a-ModelParseError:${String(e)}`;
      }
      return 'no-throw';
    };
    expect(codeOf(() => parseStl(new Uint8Array(0)))).toBe('E_MODEL_EMPTY');
    expect(codeOf(() => parseStl(makeBinaryStl(TWO_TRIS), { maxSourceBytes: 10 }))).toBe('E_MODEL_TOO_LARGE');
    expect(codeOf(() => parseStl(makeBinaryStl(TWO_TRIS), { maxTriangles: 1 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
  });
});

describe('ModelRenderer background', () => {
  it('transparent → null scene background; a color → a three Color', () => {
    const t = new ModelRenderer({ canvas: stubCanvas(), background: 'transparent', createRenderer: stubGL });
    expect(t.scene.background).toBeNull();
    t.dispose();
    const c = new ModelRenderer({ canvas: stubCanvas(), background: '#112233', createRenderer: stubGL });
    expect(c.scene.background).toBeInstanceOf(Color);
    c.dispose();
  });

  it('setScene builds one mesh per object and frames the camera off the bed', () => {
    const r = new ModelRenderer({ canvas: stubCanvas(), createRenderer: stubGL });
    r.setScene(parseStl(makeBinaryStl(TWO_TRIS)));
    // One mesh added under the rotated root.
    const meshes = r.scene.children.flatMap((c) => (c.type === 'Group' ? c.children : []));
    expect(meshes.filter((m) => m.type === 'Mesh')).toHaveLength(1);
    // Camera framed to a finite position away from the target.
    expect(Number.isFinite(r.camera.position.x)).toBe(true);
    expect(r.camera.position.length()).toBeGreaterThan(0);
    r.dispose();
  });
});

describe('renderModelStill', () => {
  it('renders STL bytes → result with honest materials + a stable cache key', async () => {
    const bytes = makeBinaryStl(TWO_TRIS);
    const a = await renderModelStill(
      { kind: 'stl', bytes },
      { canvas: stubCanvas(), width: 128, height: 96, createRenderer: stubGL }
    );
    expect(a.objectCount).toBe(1);
    expect(a.materials).toBe('unavailable');
    expect(a.width).toBe(128);
    expect(a.height).toBe(96);
    // Deterministic: same input + options → same key.
    const b = await renderModelStill(
      { kind: 'stl', bytes },
      { canvas: stubCanvas(), width: 128, height: 96, createRenderer: stubGL }
    );
    expect(b.cacheKey).toBe(a.cacheKey);
    // Sensitive to options.
    const c = await renderModelStill(
      { kind: 'stl', bytes },
      { canvas: stubCanvas(), width: 200, height: 96, createRenderer: stubGL }
    );
    expect(c.cacheKey).not.toBe(a.cacheKey);
  });

  it('accepts a pre-built ModelScene source', async () => {
    const scene: ModelScene = parseStl(makeBinaryStl(TWO_TRIS));
    const res = await renderModelStill(scene, { canvas: stubCanvas(), createRenderer: stubGL });
    expect(res.objectCount).toBe(1);
    expect(res.cacheKey.startsWith('mr1_')).toBe(true);
  });
});

describe('computeCacheKey', () => {
  it('changes with source bytes, options, and envId; stable otherwise', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const base = computeCacheKey(src, '{"w":1}', 'env1');
    expect(computeCacheKey(src, '{"w":1}', 'env1')).toBe(base);
    expect(computeCacheKey(new Uint8Array([1, 2, 3, 5]), '{"w":1}', 'env1')).not.toBe(base);
    expect(computeCacheKey(src, '{"w":2}', 'env1')).not.toBe(base);
    expect(computeCacheKey(src, '{"w":1}', 'env2')).not.toBe(base);
  });
});
