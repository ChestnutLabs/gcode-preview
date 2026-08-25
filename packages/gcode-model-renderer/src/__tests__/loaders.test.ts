import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODEL_LOADERS,
  isModelScene,
  resolveModelScene,
  stlLoader,
  threeMfLoader,
  type ModelLoader
} from '../loaders.js';
import { ModelParseError } from '../limits.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

type Tri = [number[], number[], number[]];

function makeBinaryStl(tris: Tri[]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    o += 12;
    for (const v of t) {
      dv.setFloat32(o, v[0], true);
      dv.setFloat32(o + 4, v[1], true);
      dv.setFloat32(o + 8, v[2], true);
      o += 12;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}

const ONE_TRI: Tri[] = [
  [
    [0, 0, 0],
    [10, 0, 0],
    [0, 20, 0]
  ]
];

function bareScene(): ModelScene {
  return {
    objects: [
      {
        id: 'x',
        geometry: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) },
        transform: IDENTITY_MAT4
      }
    ],
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    capabilities: { materials: 'unavailable', transforms: 'unavailable', multiObject: 'unavailable' }
  };
}

describe('loader registry', () => {
  it('registers stl + 3mf by default', () => {
    expect(DEFAULT_MODEL_LOADERS.map((l) => l.kind)).toEqual(['stl', '3mf']);
    expect(stlLoader.kind).toBe('stl');
    expect(threeMfLoader.kind).toBe('3mf');
  });

  it('isModelScene distinguishes a pre-built scene from tagged bytes', () => {
    expect(isModelScene(bareScene())).toBe(true);
    expect(isModelScene({ kind: 'stl', bytes: new Uint8Array(1) })).toBe(false);
  });

  it('resolves stl bytes through the registry', async () => {
    const scene = await resolveModelScene({ kind: 'stl', bytes: makeBinaryStl(ONE_TRI) });
    expect(scene.objects).toHaveLength(1);
    expect(scene.capabilities.materials).toBe('unavailable');
  });

  it('passes a pre-built ModelScene straight through', async () => {
    const src = bareScene();
    expect(await resolveModelScene(src)).toBe(src);
  });

  it('unknown kind → E_MODEL_UNSUPPORTED_KIND (never thrown as a bare Error)', async () => {
    await expect(resolveModelScene({ kind: 'obj', bytes: new Uint8Array(1) })).rejects.toMatchObject({
      code: 'E_MODEL_UNSUPPORTED_KIND'
    });
    await expect(resolveModelScene({ kind: 'obj', bytes: new Uint8Array(1) })).rejects.toBeInstanceOf(ModelParseError);
  });

  it('forwards the 3MF filament-palette override only to the loader that consumes it', async () => {
    // A stub stl-like loader records the opts bag it receives.
    let seen: unknown;
    const spy: ModelLoader = {
      kind: 'stl',
      parse: (_b, _l, opts) => {
        seen = opts;
        return bareScene();
      }
    };
    await resolveModelScene({ kind: 'stl', bytes: new Uint8Array(1) }, [spy], undefined, {
      filamentPalette: ['#ff0000']
    });
    expect(seen).toEqual({ filamentPalette: ['#ff0000'] });
  });

  // DD-021 §9 extensibility guarantee: a brand-new `kind` becomes viewable by registering a loader
  // ONLY — no change to resolveModelScene / the public input type.
  it('a newly registered loader kind resolves with no API change', async () => {
    const marker = bareScene();
    const objLoader: ModelLoader = { kind: 'obj', parse: () => marker };
    const scene = await resolveModelScene({ kind: 'obj', bytes: new Uint8Array([1, 2, 3]) }, [
      ...DEFAULT_MODEL_LOADERS,
      objLoader
    ]);
    expect(scene).toBe(marker);
  });
});
