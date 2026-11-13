/**
 * 3MF vertex-count bound: a 3MF declares no vertex count, so vertices are bounded at 3 × maxTriangles
 * (a mesh with no shared vertices) — per object and as a running total across objects and parts —
 * and the check fires BEFORE the vertex array grows past the cap.
 */
import { describe, it, expect } from 'vitest';
import { parse3mf } from '../three-mf.js';
import { makeZip, enc } from './zip-fixture.js';

const vertices = (n: number): string =>
  `<vertices>${Array.from({ length: n }, (_, i) => `<vertex x="${i}" y="0" z="0"/>`).join('')}</vertices>`;
/** An object of `n` (>= 3) vertices and ONE triangle, so a file within the bound still renders. */
const vertexOnly = (id: number, n: number, withTriangle = true): string =>
  `<object id="${id}"><mesh>${vertices(n)}${
    withTriangle ? '<triangles><triangle v1="0" v2="1" v3="2"/></triangles>' : ''
  }</mesh></object>`;
/** An unindexed export: `t` triangles, each with its own 3 vertices (V = 3T). */
const unindexed = (id: number, t: number): string => {
  const tris = Array.from({ length: t }, (_, i) => `<triangle v1="${3 * i}" v2="${3 * i + 1}" v3="${3 * i + 2}"/>`);
  return `<object id="${id}"><mesh>${vertices(3 * t)}<triangles>${tris.join('')}</triangles></mesh></object>`;
};
const modelXml = (objects: string, items = '<item objectid="1"/>'): string =>
  `<?xml version="1.0"?><model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>${objects}</resources><build>${items}</build></model>`;
const mainOnly = (objects: string): Uint8Array => makeZip([{ name: '3D/3dmodel.model', data: enc(modelXml(objects)) }]);

const tooMany = (cap: number, tris: number) =>
  expect.objectContaining({
    code: 'E_MODEL_TOO_MANY_VERTICES',
    message: `3MF holds more than ${cap} vertices (3 × maxTriangles ${tris})`
  });

describe('3MF vertex bound (3 × maxTriangles)', () => {
  it('single object: cap - 1 and cap vertices parse, cap + 1 throws E_MODEL_TOO_MANY_VERTICES', async () => {
    // maxTriangles 4 -> cap 12 vertices.
    await expect(parse3mf(mainOnly(vertexOnly(1, 11)), { maxTriangles: 4 })).resolves.toBeDefined();
    await expect(parse3mf(mainOnly(vertexOnly(1, 12)), { maxTriangles: 4 })).resolves.toBeDefined();
    await expect(parse3mf(mainOnly(vertexOnly(1, 13)), { maxTriangles: 4 })).rejects.toEqual(tooMany(12, 4));
  });

  it('maxTriangles 0 rejects the very first vertex (cap 0)', async () => {
    await expect(parse3mf(mainOnly(vertexOnly(1, 1, false)), { maxTriangles: 0 })).rejects.toEqual(tooMany(0, 0));
  });

  it('the cap moves with maxTriangles', async () => {
    await expect(parse3mf(mainOnly(vertexOnly(1, 13)), { maxTriangles: 5 })).resolves.toBeDefined();
    await expect(parse3mf(mainOnly(vertexOnly(1, 16)), { maxTriangles: 5 })).rejects.toEqual(tooMany(15, 5));
  });

  it('running total across two objects crosses the cap', async () => {
    // cap 12: 7 + 5 = 12 passes, 7 + 6 = 13 throws although neither object alone is over.
    await expect(parse3mf(mainOnly(vertexOnly(1, 7) + vertexOnly(2, 5)), { maxTriangles: 4 })).resolves.toBeDefined();
    await expect(parse3mf(mainOnly(vertexOnly(1, 7) + vertexOnly(2, 6)), { maxTriangles: 4 })).rejects.toEqual(
      tooMany(12, 4)
    );
  });

  it('running total spans the main part and an external production-extension part', async () => {
    const asm = (mainN: number, extN: number): Uint8Array =>
      makeZip([
        {
          name: '3D/3dmodel.model',
          data: enc(
            modelXml(
              vertexOnly(1, mainN) +
                `<object id="9"><components><component p:path="/3D/Objects/a.model" objectid="2"/></components></object>`,
              '<item objectid="9"/>'
            )
          )
        },
        { name: '3D/Objects/a.model', data: enc(modelXml(vertexOnly(2, extN))) }
      ]);
    await expect(parse3mf(asm(7, 5), { maxTriangles: 4 })).resolves.toBeDefined();
    await expect(parse3mf(asm(7, 6), { maxTriangles: 4 })).rejects.toEqual(tooMany(12, 4));
  });

  it('a zero-triangle file of vertices only is rejected over the cap', async () => {
    await expect(parse3mf(mainOnly(vertexOnly(1, 40, false)), { maxTriangles: 4 })).rejects.toEqual(tooMany(12, 4));
    // ...and within the cap the same shape is the ordinary "no geometry" error, not a vertex error.
    await expect(parse3mf(mainOnly(vertexOnly(1, 12, false)), { maxTriangles: 4 })).rejects.toMatchObject({
      code: 'E_MODEL_EMPTY'
    });
  });

  it('an unindexed export at exactly V = 3T still parses at the triangle cap', async () => {
    const m = await parse3mf(mainOnly(unindexed(1, 4)), { maxTriangles: 4 });
    expect(m.objects).toHaveLength(1);
    // one more triangle trips the (unchanged) triangle bound first or the vertex bound — never a silent pass
    await expect(parse3mf(mainOnly(unindexed(1, 5)), { maxTriangles: 4 })).rejects.toMatchObject({
      code: expect.stringMatching(/^E_MODEL_TOO_MANY_(TRIANGLES|VERTICES)$/)
    });
  });

  it('throws before the vertex array grows past the cap (array-length spy)', async () => {
    // Record the longest array any push() produced while parsing 600 vertices against a cap of 12 (36 numbers).
    let longest = 0;
    const bytes = mainOnly(vertexOnly(1, 600));
    const realPush = Array.prototype.push;
    // A plain wrapper (not vi.spyOn: the spy machinery itself pushes and would recurse).
    Array.prototype.push = function (this: unknown[], ...items: unknown[]): number {
      const n = realPush.apply(this, items);
      if (n > longest) longest = n;
      return n;
    };
    try {
      await expect(parse3mf(bytes, { maxTriangles: 4 })).rejects.toEqual(tooMany(12, 4));
    } finally {
      Array.prototype.push = realPush;
    }
    expect(longest).toBe(36);
  });

  // An external production-extension part reached by TWO build items (Bambu/Orca instancing): it is parsed once
  // (partCache), so its vertices count once. Double counting would cross the cap.
  const twoItemsOnePart = (extObject: string): Uint8Array => {
    const comp = (id: number): string =>
      `<object id="${id}"><components><component p:path="/3D/Objects/a.model" objectid="2"/></components></object>`;
    return makeZip([
      { name: '3D/3dmodel.model', data: enc(modelXml(comp(8) + comp(9), '<item objectid="8"/><item objectid="9"/>')) },
      { name: '3D/Objects/a.model', data: enc(modelXml(extObject)) }
    ]);
  };

  it('an external part reached by two build items counts its vertices once', async () => {
    // maxTriangles 4 -> cap 12. 7 vertices once = 7 (loads); counted twice would be 14 > 12.
    const m = await parse3mf(twoItemsOnePart(vertexOnly(2, 7)), { maxTriangles: 4 });
    expect(m.objects).toHaveLength(1);
    // ...and 13 vertices in the part alone still crosses the cap once.
    await expect(parse3mf(twoItemsOnePart(vertexOnly(2, 13)), { maxTriangles: 4 })).rejects.toEqual(tooMany(12, 4));
  });
});

/** An object over 3 shared vertices with `t` triangles (all v1=0 v2=1 v3=2). */
const triOnly = (id: number, t: number): string =>
  `<object id="${id}"><mesh>${vertices(3)}<triangles>${'<triangle v1="0" v2="1" v3="2"/>'.repeat(t)}</triangles></mesh></object>`;
const triTooMany = (tris: number) =>
  expect.objectContaining({ code: 'E_MODEL_TOO_MANY_TRIANGLES', message: `3MF exceeds triangle limit ${tris}` });

describe('3MF triangle bound (scene-wide, at parse time)', () => {
  it('six objects of maxTriangles triangles with only one placed is rejected (6x the cap is not parsed)', async () => {
    const objs = [1, 2, 3, 4, 5, 6].map((id) => triOnly(id, 10)).join('');
    const bytes = makeZip([{ name: '3D/3dmodel.model', data: enc(modelXml(objs, '<item objectid="1"/>')) }]);
    await expect(parse3mf(bytes, { maxTriangles: 10 })).rejects.toEqual(triTooMany(10));
  });

  it('a file exactly at the cap loads, one triangle more across two objects rejects', async () => {
    const both = '<item objectid="1"/><item objectid="2"/>';
    const at = makeZip([{ name: '3D/3dmodel.model', data: enc(modelXml(triOnly(1, 5) + triOnly(2, 5), both)) }]);
    const over = makeZip([{ name: '3D/3dmodel.model', data: enc(modelXml(triOnly(1, 6) + triOnly(2, 5), both)) }]);
    const m = await parse3mf(at, { maxTriangles: 10 });
    expect(m.objects).toHaveLength(2);
    await expect(parse3mf(over, { maxTriangles: 10 })).rejects.toEqual(triTooMany(10));
  });

  it('maxTriangles 0 rejects the very first triangle (cap 0, before its indices are read)', async () => {
    // No vertices, so only the triangle bound can fire; the triangle's indices are out of range and must not be read.
    const noVerts = '<object id="1"><mesh><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>';
    await expect(parse3mf(mainOnly(noVerts), { maxTriangles: 0 })).rejects.toEqual(triTooMany(0));
  });

  it('a single object at the cap loads and cap + 1 rejects', async () => {
    await expect(parse3mf(mainOnly(triOnly(1, 10)), { maxTriangles: 10 })).resolves.toBeDefined();
    await expect(parse3mf(mainOnly(triOnly(1, 11)), { maxTriangles: 10 })).rejects.toEqual(triTooMany(10));
  });

  it('an external part reached by two build items counts its triangles once', async () => {
    const comp = (id: number): string =>
      `<object id="${id}"><components><component p:path="/3D/Objects/a.model" objectid="2"/></components></object>`;
    const bytes = makeZip([
      { name: '3D/3dmodel.model', data: enc(modelXml(comp(8) + comp(9), '<item objectid="8"/><item objectid="9"/>')) },
      { name: '3D/Objects/a.model', data: enc(modelXml(triOnly(2, 7))) }
    ]);
    // 7 triangles once = 7 <= 10 (loads); counted twice would be 14 > 10.
    const m = await parse3mf(bytes, { maxTriangles: 10 });
    expect(m.objects).toHaveLength(1);
  });

  it('triangles split across the main model and an external part count together', async () => {
    const comp = (id: number): string =>
      `<object id="${id}"><components><component p:path="/3D/Objects/a.model" objectid="2"/></components></object>`;
    // An UNPLACED 6-triangle object in the main model plus a 7-triangle external part: 13 > 10 scene-wide, although
    // each part alone is under the cap. A per-part counter would load it.
    const bytes = makeZip([
      {
        name: '3D/3dmodel.model',
        data: enc(modelXml(triOnly(1, 6) + comp(8) + comp(9), '<item objectid="8"/><item objectid="9"/>'))
      },
      { name: '3D/Objects/a.model', data: enc(modelXml(triOnly(2, 7))) }
    ]);
    await expect(parse3mf(bytes, { maxTriangles: 10 })).rejects.toEqual(triTooMany(10));
  });

  it('throws before the triangle array grows past the cap (array-length spy)', async () => {
    let longest = 0;
    const bytes = mainOnly(triOnly(1, 11));
    const realPush = Array.prototype.push;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]): number {
      const n = realPush.apply(this, items);
      if (n > longest) longest = n;
      return n;
    };
    try {
      await expect(parse3mf(bytes, { maxTriangles: 10 })).rejects.toEqual(triTooMany(10));
    } finally {
      Array.prototype.push = realPush;
    }
    expect(longest).toBe(30);
  });
});
