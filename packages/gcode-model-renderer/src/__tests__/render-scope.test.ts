/**
 * DD-030 D2 — per-plate / object-subset render scope. `applyRenderScope` is a pure, three-free filter,
 * unit-tested here against a synthetic multi-plate scene (no GL, no 3MF needed).
 */
import { describe, it, expect } from 'vitest';
import { applyRenderScope, type Mat4, type ModelScene } from '../index.js';

/** Column-major translate matrix (three `Matrix4.elements` layout). */
const translate = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
/** A unit-cube geometry (AABB 0..1) — only the extremes matter for bounds. */
const unitCube = () => ({ positions: new Float32Array([0, 0, 0, 1, 1, 1]) });

/** A 2-object scene: 'a' instanced on plates 1 & 2 (x=0 and x=10); 'b' single placement on plate 1 (y=10). */
function multiPlateScene(withPlateIds = true): ModelScene {
  return {
    objects: [
      {
        id: 'a',
        geometry: unitCube(),
        transform: translate(0, 0, 0),
        instances: [translate(0, 0, 0), translate(10, 0, 0)],
        ...(withPlateIds ? { plateIds: [1, 2] } : {})
      },
      {
        id: 'b',
        geometry: unitCube(),
        transform: translate(0, 10, 0),
        ...(withPlateIds ? { plateIds: [1] } : {})
      }
    ],
    bounds: { min: [0, 0, 0], max: [11, 11, 1] },
    plates: {
      list: [
        { id: 1, objectCount: 2, instanceCount: 2, bounds: { min: [0, 0, 0], max: [1, 11, 1] } },
        { id: 2, objectCount: 1, instanceCount: 1, bounds: { min: [10, 0, 0], max: [11, 1, 1] } }
      ]
    },
    capabilities: {
      materials: 'unavailable',
      transforms: 'known',
      multiObject: 'known',
      instanced: 'known',
      plates: 'known'
    }
  };
}

describe('applyRenderScope — plate selection', () => {
  it('{plateId:1} keeps plate 1 placements and reframes to them', () => {
    const s = applyRenderScope(multiPlateScene(), { plateId: 1 });
    expect(s.objects.map((o) => o.id).sort()).toEqual(['a', 'b']);
    // 'a' kept only its plate-1 placement (x=0) → collapsed to a single placement (no instances).
    const a = s.objects.find((o) => o.id === 'a')!;
    expect(a.instances).toBeUndefined();
    expect(a.transform[12]).toBe(0); // x translation of the kept placement
    // Bounds cover a@(0,0,0)..(1,1,1) ∪ b@(0,10,0)..(1,11,1).
    expect(s.bounds.max[1]).toBeCloseTo(11);
    expect(s.bounds.max[0]).toBeCloseTo(1);
  });

  it('{plateId:2} keeps only object a at x=10 and drops b', () => {
    const s = applyRenderScope(multiPlateScene(), { plateId: 2 });
    expect(s.objects.map((o) => o.id)).toEqual(['a']);
    expect(s.objects[0].transform[12]).toBe(10);
    expect(s.bounds.min[0]).toBeCloseTo(10);
    expect(s.bounds.max[0]).toBeCloseTo(11);
  });

  it('{plateId} on a scene without plate structure matches nothing → empty scene (honest)', () => {
    const s = applyRenderScope(multiPlateScene(false), { plateId: 1 });
    expect(s.objects).toHaveLength(0);
    expect(s.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
    // The source's declared capabilities/plates are preserved (only the render is narrowed).
    expect(s.plates).toBeDefined();
  });
});

describe('applyRenderScope — object & instance subsets', () => {
  it('{objectIds} keeps only the named objects', () => {
    const s = applyRenderScope(multiPlateScene(), { objectIds: ['b'] });
    expect(s.objects.map((o) => o.id)).toEqual(['b']);
  });

  it('{instanceFilter} selects individual placements', () => {
    const s = applyRenderScope(multiPlateScene(), { instanceFilter: (id, i) => id === 'a' && i === 1 });
    expect(s.objects.map((o) => o.id)).toEqual(['a']);
    expect(s.objects[0].instances).toBeUndefined(); // single placement kept
    expect(s.objects[0].transform[12]).toBe(10);
  });

  it('a multi-placement object that keeps ≥2 placements stays instanced', () => {
    const s = applyRenderScope(multiPlateScene(), { instanceFilter: (id) => id === 'a' });
    const a = s.objects.find((o) => o.id === 'a')!;
    expect(a.instances).toHaveLength(2);
    expect(a.plateIds).toEqual([1, 2]);
  });
});
