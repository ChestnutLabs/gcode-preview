// @vitest-environment happy-dom
/**
 * Non-finite geometry (sweep part 2): a 3MF/STL whose vertices, transforms or triangle indices are NaN, Infinity or
 * beyond float32 range fails the load with E_MODEL_PARSE instead of producing NaN/Infinity positions or bounds.
 */
import { describe, expect, it } from 'vitest';
import type { GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { parse3mf } from '../three-mf.js';
import { parseStl } from '../stl.js';
import { resolveModelScene, type ModelLoader } from '../loaders.js';
import { renderModelStill } from '../render-model-still.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';
import { makeZip, enc } from './zip-fixture.js';

const NS = 'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
const mesh = (v: [string, string, string][], tri = '<triangle v1="0" v2="1" v3="2"/>'): string =>
  `<mesh><vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices><triangles>${tri}</triangles></mesh>`;
const GOOD: [string, string, string][] = [
  ['0', '0', '0'],
  ['1', '0', '0'],
  ['0', '1', '0']
];
const zip = (objects: string, item = '<item objectid="1"/>', unit = 'millimeter'): Uint8Array =>
  makeZip([
    {
      name: '3D/3dmodel.model',
      data: enc(
        `<?xml version="1.0"?><model unit="${unit}" ${NS}><resources>${objects}</resources><build>${item}</build></model>`
      )
    }
  ]);
const obj = (m: string): string => `<object id="1">${m}</object>`;
const withVertex = (at: number, axis: 0 | 1 | 2, value: string): Uint8Array => {
  const v = GOOD.map((p) => [...p]) as [string, string, string][];
  v[at][axis] = value;
  return zip(obj(mesh(v)));
};
const PARSE = 'E_MODEL_PARSE';

describe('3MF vertices', () => {
  for (const bad of ['Infinity', '-Infinity', '1e999', '-1e999', '1e300', '-1e300', 'NaN', 'abc']) {
    it(`rejects ${bad} naming the vertex and axis`, async () => {
      await expect(parse3mf(withVertex(1, 0, bad))).rejects.toMatchObject({
        code: PARSE,
        message: '3MF vertex 1 x is not a finite float32 value'
      });
    });
  }

  it('names the y and z axes and the vertex index', async () => {
    await expect(parse3mf(withVertex(2, 1, '1e300'))).rejects.toMatchObject({
      message: '3MF vertex 2 y is not a finite float32 value'
    });
    await expect(parse3mf(withVertex(0, 2, 'Infinity'))).rejects.toMatchObject({
      message: '3MF vertex 0 z is not a finite float32 value'
    });
  });

  it('accepts exactly float32 max and rejects the next representable double', async () => {
    const ok = await parse3mf(withVertex(1, 0, '3.4028234663852886e38'));
    expect(ok.bounds.max[0]).toBe(3.4028234663852886e38);
    await expect(parse3mf(withVertex(1, 0, '3.4028235e38'))).rejects.toMatchObject({ code: PARSE });
  });

  it('still reads an absent coordinate as 0', async () => {
    const xml = zip(
      obj(
        '<mesh><vertices><vertex x="1" y="2"/><vertex x="3"/><vertex/></vertices>' +
          '<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>'
      )
    );
    const scene = await parse3mf(xml);
    expect(Array.from(scene.objects[0].geometry.positions)).toEqual([1, 2, 0, 3, 0, 0, 0, 0, 0]);
  });

  it('rejects a coordinate that only overflows after unit scaling (meter -> mm)', async () => {
    const big = zip(obj(mesh([['1e36', '0', '0'], ...GOOD.slice(1)])), '<item objectid="1"/>', 'meter');
    await expect(parse3mf(big)).rejects.toMatchObject({
      code: PARSE,
      message: '3MF vertex 0 overflows float32 after unit scaling'
    });
    const bigY = zip(obj(mesh([['0', '1e36', '0'], ...GOOD.slice(1)])), '<item objectid="1"/>', 'meter');
    await expect(parse3mf(bigY)).rejects.toMatchObject({
      message: '3MF vertex 0 overflows float32 after unit scaling'
    });
    const bigZ = zip(obj(mesh([['0', '0', '1e36'], ...GOOD.slice(1)])), '<item objectid="1"/>', 'meter');
    await expect(parse3mf(bigZ)).rejects.toMatchObject({
      message: '3MF vertex 0 overflows float32 after unit scaling'
    });
    const fits = zip(obj(mesh([['1e35', '0', '0'], ...GOOD.slice(1)])), '<item objectid="1"/>', 'meter');
    expect((await parse3mf(fits)).bounds.max[0]).toBeCloseTo(1e38, -30);
  });
});

describe('3MF transforms', () => {
  const T = (entry: string, at = 9): string =>
    Array.from({ length: 12 }, (_, i) => (i === at ? entry : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0][i])).join(' ');

  for (const bad of ['Infinity', '-Infinity', '1e999', '1e300', 'NaN']) {
    it(`rejects ${bad} in a build-item transform, naming the entry`, async () => {
      await expect(
        parse3mf(zip(obj(mesh(GOOD)), `<item objectid="1" transform="${T(bad, 10)}"/>`))
      ).rejects.toMatchObject({
        code: PARSE,
        message: '3MF transform entry 10 is not a finite float32 value'
      });
    });
  }

  it('rejects a bad component transform too', async () => {
    const objs = `<object id="1"><components><component objectid="2" transform="${T('Infinity', 0)}"/></components></object><object id="2">${mesh(GOOD)}</object>`;
    await expect(parse3mf(zip(objs))).rejects.toMatchObject({
      code: PARSE,
      message: '3MF transform entry 0 is not a finite float32 value'
    });
  });

  it('a transform that is not 12 values stays identity (unchanged behaviour)', async () => {
    const scene = await parse3mf(zip(obj(mesh(GOOD)), '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 5 5"/>'));
    expect(scene.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
  });

  it('a transform with more than 12 values stays identity (extra values are not read as translation)', async () => {
    const scene = await parse3mf(zip(obj(mesh(GOOD)), '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 5 5 5 5"/>'));
    expect(scene.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
  });

  it('accepts a finite transform and applies it', async () => {
    const scene = await parse3mf(zip(obj(mesh(GOOD)), `<item objectid="1" transform="${T('7', 9)}"/>`));
    expect(scene.bounds).toEqual({ min: [7, 0, 0], max: [8, 1, 0] });
  });

  it('rejects nested component transforms whose product overflows float32', async () => {
    const s = '1e30 0 0 0 1e30 0 0 0 1e30 0 0 0';
    const objs =
      `<object id="1"><components><component objectid="2" transform="${s}"/></components></object>` +
      `<object id="2"><components><component objectid="3" transform="${s}"/></components></object>` +
      `<object id="3">${mesh(GOOD)}</object>`;
    await expect(parse3mf(zip(objs))).rejects.toMatchObject({
      code: PARSE,
      message: '3MF placement transform overflows float32 after composing components'
    });
  });

  it('rejects in-range vertices and matrix whose transformed bounds overflow', async () => {
    const s = '1e30 0 0 0 1e30 0 0 0 1e30 0 0 0';
    const big = mesh([
      ['0', '0', '0'],
      ['1e30', '0', '0'],
      ['0', '1e30', '0']
    ]);
    await expect(parse3mf(zip(obj(big), `<item objectid="1" transform="${s}"/>`))).rejects.toMatchObject({
      code: PARSE,
      message: expect.stringMatching(/^3MF bounds are not finite float32 values \(got 1(\.0+\d*)?e\+60\)$/)
    });
  });
});

describe('3MF triangle indices', () => {
  const tri = (a: string, b: string, c: string): string => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`;
  const run = (t: string): Promise<ModelScene> => parse3mf(zip(obj(mesh(GOOD, t))));

  it('rejects an index equal to the vertex count (out of range)', async () => {
    await expect(run(tri('0', '1', '3'))).rejects.toMatchObject({
      code: PARSE,
      message: '3MF triangle 0 references vertex 3, but the mesh has 3 vertices'
    });
  });

  it('accepts the last valid index', async () => {
    const scene = await run(tri('0', '1', '2'));
    expect(Array.from(scene.objects[0].geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('rejects a huge integer index as out of range', async () => {
    await expect(run(tri('0', '1', '1e20'))).rejects.toMatchObject({
      message: '3MF triangle 0 references vertex 100000000000000000000, but the mesh has 3 vertices'
    });
  });

  for (const [bad, corner] of [
    ['-1', 'v1'],
    ['1.5', 'v2'],
    ['abc', 'v3'],
    ['Infinity', 'v1'],
    ['NaN', 'v2']
  ] as const) {
    it(`rejects ${bad} as ${corner}`, async () => {
      const args = { v1: '0', v2: '1', v3: '2', [corner]: bad };
      await expect(run(tri(args.v1, args.v2, args.v3))).rejects.toMatchObject({
        code: PARSE,
        message: `3MF triangle 0 ${corner} is not a non-negative integer index`
      });
    });
  }

  it('rejects a missing index and numbers the triangle', async () => {
    await expect(run(tri('0', '1', '2') + '<triangle v1="0" v3="2"/>')).rejects.toMatchObject({
      message: '3MF triangle 1 v2 is not a non-negative integer index'
    });
  });

  it('rejects a triangle referencing a mesh with no vertices', async () => {
    const empty = '<mesh><vertices/><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh>';
    await expect(parse3mf(zip(obj(empty)))).rejects.toMatchObject({
      message: '3MF triangle 0 references vertex 0, but the mesh has 0 vertices'
    });
  });
});

describe('STL', () => {
  const binary = (coords: number[]): Uint8Array => {
    const tris = coords.length / 9;
    const b = new Uint8Array(84 + 50 * tris);
    const dv = new DataView(b.buffer);
    dv.setUint32(80, tris, true);
    for (let t = 0; t < tris; t++) {
      for (let i = 0; i < 9; i++) dv.setFloat32(84 + 50 * t + 12 + i * 4, coords[t * 9 + i], true);
    }
    return b;
  };
  const good = [0, 0, 0, 1, 0, 0, 0, 1, 0];

  for (const bad of [NaN, Infinity, -Infinity]) {
    it(`binary: ${String(bad)} fails with E_MODEL_PARSE naming the vertex`, () => {
      const c = [...good, 0, 0, 0, 1, 0, 0, 0, 1, 0];
      c[9 + 7] = bad; // second triangle, vertex 2 (index 5), y
      expect(() => parseStl(binary(c))).toThrow(
        expect.objectContaining({
          code: PARSE,
          message: `STL vertex 5 has a non-finite coordinate (${String(bad)})`
        })
      );
    });
  }

  it('an all-NaN STL fails the load rather than yielding NaN bounds', () => {
    expect(() => parseStl(binary(Array.from({ length: 9 }, () => NaN)))).toThrow(
      expect.objectContaining({ code: PARSE, message: 'STL vertex 0 has a non-finite coordinate (NaN)' })
    );
  });

  it('ASCII: 1e999 overflows float32 and fails', () => {
    const ascii =
      'solid s\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1e999 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid s\n';
    expect(() => parseStl(enc(ascii))).toThrow(
      expect.objectContaining({ code: PARSE, message: 'STL vertex 1 has a non-finite coordinate (Infinity)' })
    );
  });

  it('float32 max is a valid coordinate', () => {
    const scene = parseStl(binary([0, 0, 0, 3.4028234663852886e38, 0, 0, 0, 1, 0]));
    expect(scene.bounds).toEqual({ min: [0, 0, 0], max: [3.4028234663852886e38, 1, 0] });
  });

  it('a finite STL has finite bounds', () => {
    expect(parseStl(binary(good)).bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
  });
});

describe('scene bounds seam', () => {
  const scene = (min: number[], max: number[]): ModelScene => ({
    objects: [
      { id: 'o', geometry: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) }, transform: IDENTITY_MAT4 }
    ],
    bounds: { min: min as [number, number, number], max: max as [number, number, number] },
    capabilities: {
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  });

  it('resolveModelScene passes a finite pre-built scene through unchanged', async () => {
    const s = scene([0, 0, 0], [1, 1, 0]);
    await expect(resolveModelScene(s)).resolves.toBe(s);
  });

  for (const [label, min, max, got] of [
    ['NaN min', [NaN, 0, 0], [1, 1, 0], 'NaN'],
    ['Infinity max', [0, 0, 0], [1, Infinity, 0], 'Infinity'],
    ['-Infinity min', [0, 0, -Infinity], [1, 1, 0], '-Infinity'],
    ['beyond float32', [0, 0, 0], [1, 1, 1e300], '1e+300']
  ] as const) {
    it(`resolveModelScene rejects a pre-built scene with ${label}`, async () => {
      await expect(resolveModelScene(scene([...min], [...max]))).rejects.toMatchObject({
        code: PARSE,
        message: `ModelScene bounds are not finite float32 values (got ${got})`
      });
    });
  }

  it('resolveModelScene rejects a registered loader that returns NaN bounds, naming the kind', async () => {
    const loader: ModelLoader = { kind: 'xyz', parse: () => scene([NaN, 0, 0], [1, 1, 0]) };
    await expect(resolveModelScene({ kind: 'xyz', bytes: new Uint8Array(1) }, [loader])).rejects.toMatchObject({
      code: PARSE,
      message: "'xyz' loader bounds are not finite float32 values (got NaN)"
    });
  });

  it('resolveModelScene accepts an async loader with finite bounds', async () => {
    const s = scene([0, 0, 0], [1, 1, 0]);
    const loader: ModelLoader = { kind: 'xyz', parse: () => Promise.resolve(s) };
    await expect(resolveModelScene({ kind: 'xyz', bytes: new Uint8Array(1) }, [loader])).resolves.toBe(s);
  });

  it('renderModelStill rejects a pre-built scene with NaN bounds before drawing', async () => {
    const canvas = document.createElement('canvas');
    let renders = 0;
    const gl: GLRendererLike = {
      render: () => {
        renders++;
      },
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    };
    await expect(
      renderModelStill(scene([NaN, 0, 0], [1, 1, 0]), { canvas, width: 100, height: 100, createRenderer: () => gl })
    ).rejects.toMatchObject({ code: PARSE });
    expect(renders).toBe(0);
  });
});
