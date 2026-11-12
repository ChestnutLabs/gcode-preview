import { describe, it, expect } from 'vitest';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { renderModelStill } from '../render-model-still.js';
import { applyRenderScope, checkRenderScope, IDENTITY_MAT4, type ModelScene } from '../scene-model.js';
import { enc, makeZip, singleObjectModel, TWO_PLATE_MODEL, TWO_PLATE_SETTINGS } from './zip-fixture.js';

const canvas = (): RenderTargetCanvas => ({ width: 8, height: 8 }) as unknown as RenderTargetCanvas;
const gl = (d: RenderTargetCanvas): GLRendererLike => ({
  render: () => undefined,
  setSize: () => undefined,
  dispose: () => undefined,
  domElement: d
});

function stl(): Uint8Array {
  const buf = new ArrayBuffer(134);
  const dv = new DataView(buf);
  dv.setUint32(80, 1, true);
  [0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 20, 0].forEach((n, i) => dv.setFloat32(84 + i * 4, n, true));
  return new Uint8Array(buf);
}

type Obj = ModelScene['objects'][number];
const obj = (over: Partial<Obj> = {}): Obj => ({
  id: 'a',
  geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]) },
  transform: IDENTITY_MAT4,
  ...over
});
const scene = (o: Obj = obj(), over: Partial<ModelScene> = {}): ModelScene => ({
  objects: [o],
  bounds: { min: [0, 0, 0], max: [10, 10, 0] },
  capabilities: {
    materials: 'known',
    transforms: 'unavailable',
    multiObject: 'unavailable',
    instanced: 'unavailable',
    plates: 'unavailable'
  },
  ...over
});
const key = async (s: ModelScene): Promise<string> =>
  (await renderModelStill(s, { canvas: canvas(), width: 8, height: 8, createRenderer: gl, envId: 'env-1' })).cacheKey;

describe('renderModelStill cache key', () => {
  it('keeps STL source keys byte-identical to dev (literal)', async () => {
    const opts = { canvas: canvas(), width: 8, height: 8, createRenderer: gl, envId: 'env-1' };
    expect((await renderModelStill({ kind: 'stl', bytes: stl() }, opts)).cacheKey).toBe('mr1_9df6862406a9080fce6e1756');
    const scoped = await renderModelStill(
      { kind: 'stl', bytes: stl() },
      { ...opts, renderScope: { objectIds: ['stl'] }, cameraFov: 40 }
    );
    expect(scoped.cacheKey).toBe('mr1_9df686241e31e208c1edfa99');
  });

  it('an undefined selector key does not change or collapse the scope cache key', async () => {
    const opts = { canvas: canvas(), width: 8, height: 8, createRenderer: gl, envId: 'env-1', cameraFov: 40 };
    const k = async (renderScope: unknown): Promise<string> =>
      (await renderModelStill({ kind: 'stl', bytes: stl() }, { ...opts, renderScope } as never)).cacheKey;
    // Same key as the pinned `{ objectIds: ['stl'] }` + fov 40 literal above.
    expect(await k({ objectIds: ['stl'], plateId: undefined })).toBe('mr1_9df686241e31e208c1edfa99');
    const none = await k({ objectIds: ['nope'], plateId: undefined });
    expect(none).not.toBe('mr1_9df686241e31e208c1edfa99');
    const f1 = await k({ instanceFilter: () => true, plateId: undefined });
    const f2 = await k({ instanceFilter: () => true, plateId: undefined });
    const f3 = await k({ instanceFilter: () => true, objectIds: undefined });
    expect(new Set([none, f1, f2, f3]).size).toBe(4);
  });

  it('keeps 3MF source keys byte-identical to dev (literal; measured at base e6f159d too)', async () => {
    const opts = { canvas: canvas(), width: 8, height: 8, createRenderer: gl, envId: 'env-1' };
    const single = makeZip([{ name: '3D/3dmodel.model', data: enc(singleObjectModel('5 5 0')) }]);
    const twoPlate = (): Uint8Array =>
      makeZip([
        { name: '3D/3dmodel.model', data: enc(TWO_PLATE_MODEL) },
        { name: 'Metadata/model_settings.config', data: enc(TWO_PLATE_SETTINGS) }
      ]);
    const k = async (bytes: Uint8Array, extra: Record<string, unknown> = {}): Promise<string> =>
      (await renderModelStill({ kind: '3mf', bytes }, { ...opts, ...extra })).cacheKey;
    expect(await k(single)).toBe('mr1_a37f733c40c21d0716833eae');
    expect(await k(twoPlate())).toBe('mr1_84060de443356c4f878b8d16');
    expect(await k(twoPlate(), { renderScope: { plateId: 1 } })).toBe('mr1_84060de406ccc12e9d03d20f');
    expect(await k(twoPlate(), { renderScope: { plateId: 2 } })).toBe('mr1_84060de497eb61d58a78390c');
  });

  it('is deterministic for an identical pre-built scene', async () => {
    expect(await key(scene())).toBe(await key(scene()));
  });

  const variants: Array<[string, () => ModelScene]> = [
    ['geometry', () => scene(obj({ geometry: { positions: new Float32Array([0, 0, 0, 5, 0, 0, 0, 10, 0]) } }))],
    ['colour', () => scene(obj({ material: { color: [1, 0, 0] } }))],
    ['colour value', () => scene(obj({ material: { color: [0, 0, 1] } }))],
    ['transform', () => scene(obj({ transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1] }))],
    ['name', () => scene(obj({ name: 'x' }))],
    ['id', () => scene(obj({ id: 'b' }))],
    ['plateIds', () => scene(obj({ plateIds: [3] }))],
    ['instances', () => scene(obj({ instances: [IDENTITY_MAT4, IDENTITY_MAT4] }))],
    [
      'normals',
      () =>
        scene(
          obj({
            geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), normals: new Float32Array(9) }
          })
        )
    ],
    [
      'indices',
      () =>
        scene(
          obj({
            geometry: {
              positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
              indices: new Uint32Array([0, 1, 2])
            }
          })
        )
    ],
    [
      'vertex colours',
      () =>
        scene(
          obj({ geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), colors: new Float32Array(9) } })
        )
    ],
    [
      'plates',
      () =>
        scene(obj(), {
          plates: { list: [{ id: 1, objectCount: 1, instanceCount: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }] }
        })
    ],
    ['source', () => scene(obj(), { source: { slicerProject: 'bambu-orca' } })],
    ['second object', () => ({ ...scene(), objects: [obj(), obj({ id: 'b' })] })]
  ];
  for (const [name, make] of variants) {
    it(`a different ${name} gives a different key`, async () => {
      expect(await key(make())).not.toBe(await key(scene()));
    });
  }

  it('normals and vertex colours key differently from each other', async () => {
    const p = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const a = await key(scene(obj({ geometry: { positions: p, normals: new Float32Array(9) } })));
    const b = await key(scene(obj({ geometry: { positions: p, colors: new Float32Array(9) } })));
    expect(a).not.toBe(b);
  });

  it('a view into a larger buffer hashes only its own bytes', async () => {
    const big = new Float32Array([9, 9, 0, 0, 0, 10, 0, 0, 0, 10, 0, 9]);
    const view = big.subarray(2, 11);
    expect(await key(scene(obj({ geometry: { positions: view } })))).toBe(await key(scene()));
  });
});

describe('applyRenderScope bounds and validation', () => {
  it('a kept object with empty geometry yields the empty box, not Infinity', () => {
    const s = applyRenderScope(scene(obj({ geometry: { positions: new Float32Array(0) } })), { objectIds: ['a'] });
    expect(s.objects).toHaveLength(1);
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  it('an empty object plus a real one keeps the real bounds', () => {
    const full: ModelScene = {
      ...scene(),
      objects: [obj({ id: 'e', geometry: { positions: new Float32Array(0) } }), obj({ id: 'a' })]
    };
    expect(applyRenderScope(full, { objectIds: ['e', 'a'] }).bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
  });

  const bad: Array<[string, unknown]> = [
    ['empty object', {}],
    ['null', null],
    ['a string', 'a'],
    ['objectIds string', { objectIds: 'a' }],
    ['objectIds non-string member', { objectIds: [1] }],
    ['plateId float', { plateId: 1.5 }],
    ['plateId NaN', { plateId: NaN }],
    ['plateId string', { plateId: '1' }],
    ['instanceFilter non-function', { instanceFilter: true }],
    ['two selectors', { plateId: 1, objectIds: [] }]
  ];
  for (const [name, v] of bad) {
    it(`rejects ${name} with RangeError`, () => {
      expect(() => checkRenderScope(v as never)).toThrow(RangeError);
      expect(() => applyRenderScope(scene(), v as never)).toThrow(RangeError);
    });
  }

  it('accepts the three valid selectors', () => {
    expect(() => checkRenderScope({ objectIds: [] })).not.toThrow();
    expect(() => checkRenderScope({ plateId: 0 })).not.toThrow();
    expect(() => checkRenderScope({ instanceFilter: () => true })).not.toThrow();
  });

  it('renderModelStill rejects a bad scope before doing any work', async () => {
    await expect(
      renderModelStill(scene(), { canvas: canvas(), createRenderer: gl, renderScope: { objectIds: 'a' } as never })
    ).rejects.toThrow(RangeError);
  });
});
