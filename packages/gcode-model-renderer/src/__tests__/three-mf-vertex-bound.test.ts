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
});
