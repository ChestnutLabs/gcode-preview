/**
 * Placement mutation sweep: every on-bed edge at its exact tolerance, the workspace-cell maths on a bed that is
 * not at the origin, and the stricter `printable_area` parsing. Literal expected values only.
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_MAT4, type ModelScene, type ModelSceneSource } from '../scene-model.js';
import { computePlacement, parsePrintableArea, type PlacementBed } from '../placement.js';

const BED: PlacementBed = { min: [0, 0], max: [256, 256] };
const SLICER: ModelSceneSource = { slicerProject: 'bambu-orca' };

function scene(min: [number, number, number], max: [number, number, number]): ModelScene {
  return {
    objects: [
      { id: 'o', geometry: { positions: new Float32Array([...min, ...max, ...min]) }, transform: IDENTITY_MAT4 }
    ],
    bounds: { min, max },
    capabilities: {
      materials: 'unavailable',
      transforms: 'known',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    },
    source: SLICER
  };
}
const place = (s: ModelScene, bed: PlacementBed = BED) => computePlacement(s, s, null, bed);

describe('on-bed tolerance is exactly 1 mm on every edge (inclusive)', () => {
  // [label, min, max, placement]
  const cases: [string, [number, number, number], [number, number, number], string][] = [
    ['min x at -1', [-1, 100, 0], [50, 150, 5], 'known'],
    ['min x at -1.01', [-1.01, 100, 0], [50, 150, 5], 'approximated'],
    ['min y at -1', [100, -1, 0], [150, 50, 5], 'known'],
    ['min y at -0.9', [100, -0.9, 0], [150, 50, 5], 'known'],
    ['min y at -1.01', [100, -1.01, 0], [150, 50, 5], 'approximated'],
    ['max x at 257', [200, 100, 0], [257, 150, 5], 'known'],
    ['max x at 257.01', [200, 100, 0], [257.01, 150, 5], 'approximated'],
    ['max y at 257', [100, 200, 0], [150, 257, 5], 'known'],
    ['max y at 256.9', [100, 200, 0], [150, 256.9, 5], 'known'],
    ['max y at 257.01', [100, 200, 0], [150, 257.01, 5], 'approximated']
  ];
  it.each(cases)('%s', (_label, min, max, expected) => {
    expect(place(scene(min, max)).placement).toBe(expected);
  });
});

describe('inferred cell maths', () => {
  it('applies the y offset to the max edge: a part one row below whose top ends 10 mm off the bed is approximated', () => {
    // y -107.2..-40 → j = -1; shifted by +307.2 the top is at 267.2 (> 257).
    expect(place(scene([100, -107.2, 0], [150, -40, 20])).placement).toBe('approximated');
  });

  it('is not fooled by an i != 0 whose shifted footprint is still off the bed', () => {
    // x 300..700 → i = 1, but 300 - 307.2 = -7.2 (< -1).
    expect(place(scene([300, 100, 0], [700, 150, 20])).placement).toBe('approximated');
  });

  const FAR: PlacementBed = { min: [1000, 1000], max: [1256, 1256] };
  it('uses the bed centre and the bed SIZE (not its position): plate 2 in +X on a bed at 1000..1256', () => {
    const r = place(scene([1410, 1050, 0], [1460, 1100, 20]), FAR);
    expect(r.placement).toBe('inferred');
    expect(r.placementOffset!.x).toBeCloseTo(-307.2, 6);
    expect(r.placementOffset!.y).toBe(0);
    expect(r.placementOffset!.z).toBe(0);
  });

  it('same in Y: a row above on a bed at 1000..1256', () => {
    const r = place(scene([1050, 1357.2, 0], [1100, 1407.2, 20]), FAR);
    expect(r.placement).toBe('inferred');
    expect(r.placementOffset!.x).toBe(0);
    expect(r.placementOffset!.y).toBeCloseTo(-307.2, 6);
  });
});

describe('parsePrintableArea rejects blank and non-numeric halves', () => {
  it.each([
    ['empty y', ['0x0', '256x256', '0x256', '256x']],
    ['blank y', ['0x0', '256x256', '0x256', '256x ']],
    ['blank x', [' x0', '256x0', '256x256']],
    ['non-numeric y', ['0x0', '256xabc', '256x256']],
    ['infinite y', ['0x0', '256xInfinity', '256x256']]
  ])('%s', (_n, value) => {
    expect(parsePrintableArea(value)).toBeUndefined();
  });
});
