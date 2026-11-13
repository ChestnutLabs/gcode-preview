/**
 * Loader seam mutation sweep: what the registry hands each loader (bytes, limits, palette) and what
 * counts as a pre-built scene.
 */
import { describe, expect, it } from 'vitest';
import { isModelScene, resolveModelScene, stlLoader, threeMfLoader, type ModelLoader } from '../loaders.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';
import { enc, makeZip } from './zip-fixture.js';

const scene: ModelScene = {
  objects: [
    { id: 'x', geometry: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) }, transform: IDENTITY_MAT4 }
  ],
  bounds: { min: [0, 0, 0], max: [1, 1, 0] },
  capabilities: {
    materials: 'unavailable',
    transforms: 'unavailable',
    multiObject: 'unavailable',
    instanced: 'unavailable',
    plates: 'unavailable'
  }
};

const stlBytes = (): Uint8Array => {
  const b = new Uint8Array(84 + 50);
  new DataView(b.buffer).setUint32(80, 1, true);
  new DataView(b.buffer).setFloat32(96, 1, true);
  return b;
};

const MODEL = (triangles: string): string =>
  `<?xml version="1.0"?><model unit="millimeter"><resources><object id="1"><mesh><vertices>` +
  `<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>` +
  `<triangles>${triangles}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
const zip = (triangles: string): Uint8Array => makeZip([{ name: '3D/3dmodel.model', data: enc(MODEL(triangles)) }]);

describe('isModelScene', () => {
  it('a tagged input is not a scene even if it also carries objects', () => {
    expect(isModelScene({ kind: 'stl', bytes: new Uint8Array(1), objects: [] } as never)).toBe(false);
  });
  it('an object with neither objects nor kind is not a scene', () => {
    expect(isModelScene({} as never)).toBe(false);
  });
});

describe('resolveModelScene', () => {
  it('hands the loader a Uint8Array view of ArrayBuffer input', async () => {
    let seen: unknown;
    const loader: ModelLoader = {
      kind: 'k',
      parse: (bytes) => {
        seen = bytes;
        return scene;
      }
    };
    await resolveModelScene({ kind: 'k', bytes: new Uint8Array([1, 2, 3]).buffer }, [loader]);
    expect(seen instanceof Uint8Array).toBe(true);
    expect(Array.from(seen as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('picks the loader whose kind matches, not the first', async () => {
    const a: ModelLoader = { kind: 'a', parse: () => ({ ...scene, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }) };
    const b: ModelLoader = { kind: 'b', parse: () => scene };
    await expect(resolveModelScene({ kind: 'b', bytes: new Uint8Array(1) }, [a, b])).resolves.toBe(scene);
  });
});

describe('registered loaders forward limits and the palette', () => {
  it('stlLoader passes limits to the parser', () => {
    expect(() => stlLoader.parse(stlBytes(), { maxTriangles: 0 })).toThrow(
      expect.objectContaining({ code: 'E_MODEL_TOO_MANY_TRIANGLES' })
    );
  });

  it('threeMfLoader passes limits to the parser', async () => {
    await expect(
      Promise.resolve(threeMfLoader.parse(zip('<triangle v1="0" v2="1" v3="2"/>'), { maxTriangles: 0 }))
    ).rejects.toMatchObject({ code: 'E_MODEL_TOO_MANY_VERTICES' });
    // The fixture's vertices come before its triangle, so with maxTriangles 0 the vertex bound (3 × 0) fires first.
  });

  it('threeMfLoader passes the filament palette override (paint_color 8 = slot 2 = red)', async () => {
    const s = await threeMfLoader.parse(zip('<triangle v1="0" v2="1" v3="2" paint_color="8"/>'), undefined, {
      filamentPalette: ['#0000FF', '#FF0000']
    });
    expect(Array.from(s.objects[0].geometry.colors!.slice(0, 3))).toEqual([1, 0, 0]);
  });

  it('threeMfLoader without a palette leaves the triangle uncoloured', async () => {
    const s = await threeMfLoader.parse(zip('<triangle v1="0" v2="1" v3="2" paint_color="8"/>'));
    expect(s.objects[0].geometry.colors).toBeUndefined();
  });
});
