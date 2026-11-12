/**
 * Hostile-input hardening for the model parsers (sweep): option validation, maxObjects, the component-graph
 * cycle guard and the component-visit budget. Every input is sized just over a cap — never a real bomb.
 */
import { describe, it, expect } from 'vitest';
import { parse3mf } from '../three-mf.js';
import { parseStl } from '../stl.js';
import { resolveLimits } from '../limits.js';
import { makeZip, enc } from './zip-fixture.js';

const MESH =
  '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>' +
  '<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
const meshObject = (id: number): string => `<object id="${id}">${MESH}</object>`;
const comps = (id: number, targets: (number | { id: number; path: string })[]): string =>
  `<object id="${id}"><components>${targets
    .map((t) =>
      typeof t === 'number' ? `<component objectid="${t}"/>` : `<component p:path="${t.path}" objectid="${t.id}"/>`
    )
    .join('')}</components></object>`;
const modelXml = (objects: string, items = '<item objectid="1"/>'): string =>
  `<?xml version="1.0"?><model unit="millimeter" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>${objects}</resources><build>${items}</build></model>`;
const mainOnly = (objects: string, items?: string): Uint8Array =>
  makeZip([{ name: '3D/3dmodel.model', data: enc(modelXml(objects, items)) }]);
const withExternal = (mainObjects: string, externalObjects: string): Uint8Array =>
  makeZip([
    { name: '3D/3dmodel.model', data: enc(modelXml(mainObjects)) },
    { name: '3D/Objects/a.model', data: enc(modelXml(externalObjects)) }
  ]);
const EXT = '/3D/Objects/a.model';

/** Objects 1..d each list the next object twice; object d+1 is an EMPTY object. Visits = 2^(d+1) - 1. */
const doublingChain = (d: number): string => {
  let s = '';
  for (let i = 1; i <= d; i++) s += comps(i, [i + 1, i + 1]);
  return s + `<object id="${d + 1}"/>`;
};

describe('limit validation (E_MODEL_OPTION)', () => {
  const FIELDS = ['maxTriangles', 'maxObjects', 'maxSourceBytes', 'maxInstances'] as const;

  it('keeps the literal defaults for undefined', () => {
    expect(resolveLimits()).toEqual({
      maxTriangles: 5_000_000,
      maxObjects: 10_000,
      maxSourceBytes: 268_435_456,
      maxInstances: 50_000
    });
    expect(resolveLimits({ maxObjects: undefined }).maxObjects).toBe(10_000);
    // JSON-sourced options carry null for "not set".
    expect(resolveLimits({ maxObjects: null as unknown as number }).maxObjects).toBe(10_000);
  });

  for (const field of FIELDS) {
    for (const bad of [NaN, Infinity, -Infinity, -1, 1.5, '7' as unknown as number]) {
      it(`${field}: ${String(bad)} throws E_MODEL_OPTION naming the field`, () => {
        expect(() => resolveLimits({ [field]: bad })).toThrow(
          expect.objectContaining({
            code: 'E_MODEL_OPTION',
            message: `${field} must be a non-negative integer (got ${String(bad)})`
          })
        );
      });
    }
    it(`${field}: 0 and a plain integer are valid`, () => {
      expect(resolveLimits({ [field]: 0 })[field]).toBe(0);
      expect(resolveLimits({ [field]: 123 })[field]).toBe(123);
    });
  }

  it('reaches both parsers (NaN no longer disables the triangle cap)', async () => {
    const stl = new Uint8Array(84 + 50);
    new DataView(stl.buffer).setUint32(80, 1, true);
    expect(() => parseStl(stl, { maxTriangles: NaN })).toThrow(expect.objectContaining({ code: 'E_MODEL_OPTION' }));
    await expect(parse3mf(mainOnly(meshObject(1)), { maxTriangles: NaN })).rejects.toMatchObject({
      code: 'E_MODEL_OPTION'
    });
  });

  it('maxTriangles 0 rejects any triangle (0 is a real bound, not "off")', () => {
    const stl = new Uint8Array(84 + 50);
    new DataView(stl.buffer).setUint32(80, 1, true);
    expect(() => parseStl(stl, { maxTriangles: 0 })).toThrow(
      expect.objectContaining({ code: 'E_MODEL_TOO_MANY_TRIANGLES' })
    );
  });
});

describe('maxObjects is enforced', () => {
  const three = meshObject(1) + meshObject(2) + meshObject(3);

  it('rejects one object over the cap and accepts exactly the cap', async () => {
    await expect(parse3mf(mainOnly(three, ''), { maxObjects: 2 })).rejects.toMatchObject({
      code: 'E_MODEL_TOO_MANY_OBJECTS',
      message: '3MF declares more than 2 objects'
    });
    const ok = await parse3mf(mainOnly(three, ''), { maxObjects: 3 });
    expect(ok.objects).toHaveLength(3);
  });

  it('counts objects across the main and an external part together', async () => {
    const main = comps(1, [{ id: 1, path: EXT }]);
    const ext = meshObject(1) + meshObject(2);
    await expect(parse3mf(withExternal(main, ext), { maxObjects: 2 })).rejects.toMatchObject({
      code: 'E_MODEL_TOO_MANY_OBJECTS'
    });
    const ok = await parse3mf(withExternal(main, ext), { maxObjects: 3 });
    expect(ok.objects).toHaveLength(1);
  });

  it('stops at the cap while scanning, before the objects are collected', async () => {
    // 4 empty self-closed objects: nothing would ever be built, so only the scan-time check can reject.
    const empties = '<object id="1"/><object id="2"/><object id="3"/><object id="4"/>';
    await expect(parse3mf(mainOnly(empties + meshObject(5), ''), { maxObjects: 4 })).rejects.toMatchObject({
      code: 'E_MODEL_TOO_MANY_OBJECTS'
    });
  });
});

describe('component graph: cycles and fan-out', () => {
  it('A → A is E_MODEL_CYCLE', async () => {
    await expect(parse3mf(mainOnly(comps(1, [1])))).rejects.toMatchObject({
      code: 'E_MODEL_CYCLE',
      message: '3MF object 1 contains itself through its components'
    });
  });

  it('A → A, A (a self-cycle that also fans out) is E_MODEL_CYCLE, not the visit budget', async () => {
    await expect(parse3mf(mainOnly(comps(1, [1, 1])))).rejects.toMatchObject({ code: 'E_MODEL_CYCLE' });
  });

  it('A → B → A is E_MODEL_CYCLE', async () => {
    await expect(parse3mf(mainOnly(comps(1, [2]) + comps(2, [1])))).rejects.toMatchObject({
      code: 'E_MODEL_CYCLE'
    });
  });

  it('a cycle inside an external part (invisible to the pre-walk) is E_MODEL_CYCLE', async () => {
    const main = comps(1, [{ id: 1, path: EXT }]);
    const ext = comps(1, [2]) + comps(2, [1]);
    await expect(parse3mf(withExternal(main, ext))).rejects.toMatchObject({ code: 'E_MODEL_CYCLE' });
  });

  it('a diamond (shared child reused across siblings) is valid and instanced', async () => {
    // 1 → {2, 3}; 2 → 4; 3 → 4; 4 is the only mesh. 4 is reached twice but is never its own ancestor.
    const scene = await parse3mf(mainOnly(comps(1, [2, 3]) + comps(2, [4]) + comps(3, [4]) + meshObject(4)));
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0].instances).toHaveLength(2);
    expect(scene.capabilities.instanced).toBe('known');
  });

  it('a diamond inside an external part is valid too', async () => {
    const main = comps(1, [{ id: 1, path: EXT }]);
    const ext = comps(1, [2, 3]) + comps(2, [4]) + comps(3, [4]) + meshObject(4);
    const scene = await parse3mf(withExternal(main, ext));
    expect(scene.objects[0].instances).toHaveLength(2);
  });

  it('doubling chain: exactly at the visit cap loads past the walk, one under it is rejected', async () => {
    // d = 5 → 2^6 - 1 = 63 visits, no mesh anywhere. At cap 63 the walk finishes (then: no geometry).
    const bytes = mainOnly(doublingChain(5));
    await expect(parse3mf(bytes, { maxInstances: 63 })).rejects.toMatchObject({ code: 'E_MODEL_EMPTY' });
    await expect(parse3mf(bytes, { maxInstances: 62 })).rejects.toMatchObject({
      code: 'E_MODEL_TOO_MANY_INSTANCES',
      message: '3MF declares more than 62 instance placements or component references'
    });
  });

  it('the default cap stops a 2^50 chain in milliseconds', async () => {
    const t = Date.now();
    await expect(parse3mf(mainOnly(doublingChain(48)))).rejects.toMatchObject({
      code: 'E_MODEL_TOO_MANY_INSTANCES'
    });
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('the resolve walk bounds a doubling chain inside an external part (pre-walk treats it as a leaf)', async () => {
    // 1 visit in main + 63 in the external chain = 64 resolve visits; the pre-walk only sees 1.
    const main = comps(1, [{ id: 1, path: EXT }]);
    const bytes = withExternal(main, doublingChain(5));
    await expect(parse3mf(bytes, { maxInstances: 64 })).rejects.toMatchObject({ code: 'E_MODEL_EMPTY' });
    await expect(parse3mf(bytes, { maxInstances: 63 })).rejects.toMatchObject({
      code: 'E_MODEL_TOO_MANY_INSTANCES'
    });
  });

  it('a dangling reference still costs a visit (a fan-out of missing ids is bounded)', async () => {
    const dangling = comps(1, [90, 91, 92]);
    await expect(parse3mf(mainOnly(dangling), { maxInstances: 4 })).rejects.toMatchObject({ code: 'E_MODEL_EMPTY' });
    await expect(parse3mf(mainOnly(dangling), { maxInstances: 3 })).rejects.toMatchObject({
      code: 'E_MODEL_TOO_MANY_INSTANCES'
    });
  });
});
