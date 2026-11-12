/**
 * DD-032 §4.3 — model-viewer plate placement. Pure unit tests over synthetic scenes (literal expected
 * values; the 256 mm bed gives the observed 307.2 mm workspace cell). The `inferred` case is synthetic by
 * design: the real two-plate fixture is a recorded follow-up.
 */
import { describe, expect, it } from 'vitest';
import { IDENTITY_MAT4, type ModelScene, type ModelSceneSource, type RenderScope } from '../scene-model.js';
import { computePlacement, parsePrintableArea, presentedBounds, type PlacementBed } from '../placement.js';

const BED: PlacementBed = { min: [0, 0], max: [256, 256] };
const SLICER: ModelSceneSource = { slicerProject: 'bambu-orca' };

function scene(
  min: [number, number, number],
  max: [number, number, number],
  extra: Partial<ModelScene> = {},
  plateIds?: number[]
): ModelScene {
  return {
    objects: [
      {
        id: 'o',
        geometry: { positions: new Float32Array([...min, ...max, ...min]) },
        transform: IDENTITY_MAT4,
        ...(plateIds ? { plateIds } : {})
      }
    ],
    bounds: { min, max },
    capabilities: {
      materials: 'unavailable',
      transforms: 'known',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    },
    ...extra
  };
}

function place(s: ModelScene, bed: PlacementBed | null = BED, scope: RenderScope | null = null) {
  return computePlacement(s, s, scope, bed);
}

describe('parsePrintableArea', () => {
  it('reads the bbox of a Bambu "XxY" polygon', () => {
    expect(parsePrintableArea(['0x0', '256x0', '256x256', '0x256'])).toEqual({ min: [0, 0], max: [256, 256] });
    expect(parsePrintableArea(['-10x-5', '180x-5', '180x200'])).toEqual({ min: [-10, -5], max: [180, 200] });
  });

  it.each([
    ['not an array', '0x0,256x0,256x256'],
    ['undefined', undefined],
    ['fewer than 3 points', ['0x0', '256x256']],
    ['a non-string point', ['0x0', '256x0', 5]],
    ['a point with 3 parts', ['0x0', '256x0x1', '256x256']],
    ['a point with no separator', ['0x0', '256', '256x256']],
    ['a non-numeric coordinate', ['0x0', 'ax0', '256x256']],
    ['an empty coordinate', ['0x0', 'x0', '256x256']],
    ['a non-finite coordinate', ['0x0', 'Infinityx0', '256x256']],
    ['a zero-area (collinear) box', ['0x0', '10x0', '20x0']],
    ['a zero-width box', ['5x0', '5x10', '5x20']],
    ['a 65-character point (rejected before splitting)', ['0x0', '256x0', '256x256', `0x${'0'.repeat(60)}256`]]
  ])('falls back (undefined) for %s', (_n, value) => {
    expect(parsePrintableArea(value)).toBeUndefined();
  });

  it('a 64-character point is still read (the cap is 64)', () => {
    const p = `0x${'0'.repeat(59)}256`;
    expect(p.length).toBe(64);
    expect(parsePrintableArea(['0x0', '256x0', '256x256', p])).toEqual({ min: [0, 0], max: [256, 256] });
  });
});

describe('computePlacement', () => {
  it('known: a Bambu/Orca project whose footprint is on the bed is drawn where authored', () => {
    expect(place(scene([100, 100, 0], [150, 150, 20], { source: SLICER }))).toEqual({
      placement: 'known',
      placementOffset: { x: 0, y: 0, z: 0 }
    });
  });

  it('known: the on-bed tolerance is 1 mm per side — 256.9 is on, 257.1 is not', () => {
    const on = place(scene([200, 100, 0], [256.9, 150, 5], { source: SLICER }));
    expect(on.placement).toBe('known');
    const off = place(scene([200, 100, 0], [257.1, 150, 5], { source: SLICER }));
    expect(off.placement).toBe('approximated');
    expect(place(scene([-0.9, 10, 0], [50, 60, 5], { source: SLICER })).placement).toBe('known');
    expect(place(scene([-1.1, 10, 0], [50, 60, 5], { source: SLICER })).placement).toBe('approximated');
  });

  it('inferred: plate 2, one workspace cell (256 × 1.2) over in +X, has the cell subtracted', () => {
    const r = place(scene([407.2, 100, 0], [457.2, 150, 20], { source: SLICER }));
    expect(r.placement).toBe('inferred');
    expect(r.placementOffset!.x).toBeCloseTo(-307.2, 6);
    expect(r.placementOffset!.y).toBe(0);
    expect(r.placementOffset!.z).toBe(0);
  });

  it('inferred: negative multiples work on both axes (a row below, a column left)', () => {
    const below = place(scene([100, -207.2, 0], [150, -157.2, 20], { source: SLICER }));
    expect(below.placement).toBe('inferred');
    expect(below.placementOffset!.x).toBe(0);
    expect(below.placementOffset!.y).toBeCloseTo(307.2, 6);
    const left = place(scene([-207.2, 100, 0], [-157.2, 150, 20], { source: SLICER }));
    expect(left.placement).toBe('inferred');
    expect(left.placementOffset!.x).toBeCloseTo(307.2, 6);
    const diag = place(scene([407.2, -207.2, 0], [457.2, -157.2, 20], { source: SLICER }));
    expect(diag.placement).toBe('inferred');
    expect(diag.placementOffset!.x).toBeCloseTo(-307.2, 6);
    expect(diag.placementOffset!.y).toBeCloseTo(307.2, 6);
  });

  it('inferred needs a slicer project: the same off-bed footprint without one is approximated', () => {
    const r = place(scene([407.2, 100, 0], [457.2, 150, 20]));
    expect(r.placement).toBe('approximated');
    expect(r.placementOffset).toEqual({ x: 128 - 432.2, y: 128 - 125, z: 0 });
  });

  it('inferred must land on the bed: a footprint between cells stays approximated', () => {
    // centre 280 → nearest cell i = 1, but 280 − 307.2 puts it at −27 .. −2: off the bed beyond tolerance.
    expect(place(scene([270, 100, 0], [290, 150, 5], { source: SLICER })).placement).toBe('approximated');
  });

  it('approximated: a CAD export centred on the origin, below z = 0, is centred on the bed and dropped to z = 0', () => {
    expect(place(scene([-20, -20, -5], [20, 20, 15])).placementOffset).toEqual({ x: 128, y: 128, z: 5 });
    expect(place(scene([-20, -20, -5], [20, 20, 15])).placement).toBe('approximated');
  });

  it('approximated: an STL (no source) is centred on the bed', () => {
    expect(place(scene([0, 0, 0], [10, 20, 0]))).toEqual({
      placement: 'approximated',
      placementOffset: { x: 123, y: 118, z: 0 }
    });
  });

  it('approximated: a source that is not a slicer project (PrusaSlicer / CAD 3MF) never reads as placed', () => {
    const r = place(scene([100, 100, 0], [150, 150, 20], { source: {} }));
    expect(r.placement).toBe('approximated');
    expect(r.placementOffset).toEqual({ x: 128 - 125, y: 128 - 125, z: 0 });
  });

  describe('the file printable_area is trusted only when it matches the drawn (consumer) bed', () => {
    const fileBed = (min: [number, number], max: [number, number]): ModelSceneSource => ({
      ...SLICER,
      printableArea: { min, max }
    });

    it('a 350 mm file bed on a 256 mm plate: a part at x 300..320 is approximated, centred on 128,128', () => {
      expect(place(scene([300, 100, 0], [320, 150, 20], { source: fileBed([0, 0], [350, 350]) }))).toEqual({
        placement: 'approximated',
        placementOffset: { x: -182, y: 3, z: 0 }
      });
    });

    it('a 350 mm file bed: a part that is on both beds is still approximated, centred on the drawn bed', () => {
      expect(place(scene([100, 100, 0], [150, 150, 20], { source: fileBed([0, 0], [350, 350]) }))).toEqual({
        placement: 'approximated',
        placementOffset: { x: 3, y: 3, z: 0 }
      });
    });

    it('a hostile ±1e308 printable_area with a part at x 9000 is approximated, not known 9 m away', () => {
      const hostile = parsePrintableArea(['-1e308x-1e308', '1e308x-1e308', '1e308x1e308', '-1e308x1e308']);
      expect(hostile).toEqual({ min: [-1e308, -1e308], max: [1e308, 1e308] });
      const r = place(scene([9000, 100, 0], [9020, 150, 20], { source: { ...SLICER, printableArea: hostile } }));
      expect(r).toEqual({ placement: 'approximated', placementOffset: { x: -8882, y: 3, z: 0 } });
    });

    it('a 180 mm file bed on a 256 mm plate is approximated and centred on the drawn bed (128,128), not 90,90', () => {
      expect(place(scene([200, 100, 0], [250, 150, 20], { source: fileBed([0, 0], [180, 180]) }))).toEqual({
        placement: 'approximated',
        placementOffset: { x: -97, y: 3, z: 0 }
      });
    });

    it('a matching 256 mm file bed is known', () => {
      expect(place(scene([200, 100, 0], [250, 150, 20], { source: fileBed([0, 0], [256, 256]) }))).toEqual({
        placement: 'known',
        placementOffset: { x: 0, y: 0, z: 0 }
      });
    });

    it('a file bed within 1 mm (0..256.5) still matches: known, and inferred uses the 256 plate cell (307.2)', () => {
      const near = fileBed([0, 0], [256.5, 256.5]);
      expect(place(scene([200, 100, 0], [250, 150, 20], { source: near })).placement).toBe('known');
      const two = place(scene([407.2, 100, 0], [457.2, 150, 20], { source: near }));
      expect(two.placement).toBe('inferred');
      expect(two.placementOffset!.x).toBeCloseTo(-307.2, 6);
      expect(two.placementOffset!.y).toBe(0);
      const below = place(scene([100, -207.2, 0], [150, -157.2, 20], { source: near }));
      expect(below.placement).toBe('inferred');
      expect(below.placementOffset!.y).toBeCloseTo(307.2, 6);
    });

    it('the match tolerance is 1 mm per edge: exactly 1 mm matches, 1.5 mm does not', () => {
      const s = (min: [number, number], max: [number, number]) =>
        place(scene([100, 100, 0], [150, 150, 20], { source: fileBed(min, max) })).placement;
      expect(s([-1, -1], [257, 257])).toBe('known');
      expect(s([-1.5, 0], [256, 256])).toBe('approximated');
    });

    it.each([
      ['min x', [2, 0], [256, 256]],
      ['min y', [0, 2], [256, 256]],
      ['max x', [0, 0], [258, 256]],
      ['max y', [0, 0], [256, 258]]
    ] as const)('a file bed off by 2 mm on %s alone is approximated', (_e, min, max) => {
      expect(place(scene([100, 100, 0], [150, 150, 20], { source: fileBed([...min], [...max]) })).placement).toBe(
        'approximated'
      );
    });

    it('no printable_area: the consumer bed decides (known)', () => {
      expect(place(scene([200, 100, 0], [250, 150, 20], { source: SLICER })).placement).toBe('known');
    });
  });

  it('a bed with a min corner offset places by that rectangle', () => {
    const bed: PlacementBed = { min: [-100, -100], max: [100, 100] };
    expect(place(scene([0, 0, 0], [10, 10, 4]), bed).placementOffset).toEqual({ x: -5, y: -5, z: 0 });
  });

  describe('null — no plate is drawn', () => {
    it('without a bed', () => {
      expect(place(scene([0, 0, 0], [10, 10, 5]), null)).toEqual({ placement: null, placementOffset: null });
    });

    it('with nothing shown (an empty scope result)', () => {
      const full = scene([0, 0, 0], [10, 10, 5], { source: SLICER });
      const empty: ModelScene = { ...full, objects: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } };
      expect(computePlacement(full, empty, { plateId: 9 }, BED)).toEqual({ placement: null, placementOffset: null });
    });

    const twoPlates = (): ModelScene =>
      scene([100, 100, 0], [460, 150, 20], {
        source: SLICER,
        plates: {
          list: [
            { id: 1, objectCount: 1, instanceCount: 1, bounds: { min: [100, 100, 0], max: [150, 150, 20] } },
            { id: 2, objectCount: 1, instanceCount: 1, bounds: { min: [407, 100, 0], max: [460, 150, 20] } }
          ]
        }
      });

    it('for an unscoped multi-plate project (one bed would misrepresent it)', () => {
      const full = twoPlates();
      expect(computePlacement(full, full, null, BED).placement).toBeNull();
    });

    it('for a scope that still spans more than one declared plate', () => {
      const full = twoPlates();
      full.objects = [{ ...full.objects[0], instances: [IDENTITY_MAT4, IDENTITY_MAT4], plateIds: [1, 2] }];
      expect(computePlacement(full, full, { objectIds: ['o'] }, BED)).toEqual({
        placement: null,
        placementOffset: null
      });
    });

    it('a single-plate scope of a multi-plate project is placed (plate 2 → inferred)', () => {
      const full = twoPlates();
      const shown = scene([407.2, 100, 0], [457.2, 150, 20], { source: SLICER }, [2]);
      const r = computePlacement(full, shown, { plateId: 2 }, BED);
      expect(r.placement).toBe('inferred');
      expect(r.placementOffset!.x).toBeCloseTo(-307.2, 6);
    });

    it('a declared single plate with no scope is a normal single bed', () => {
      const s = scene([100, 100, 0], [150, 150, 20], {
        source: SLICER,
        plates: {
          list: [{ id: 1, objectCount: 1, instanceCount: 1, bounds: { min: [100, 100, 0], max: [150, 150, 20] } }]
        }
      });
      expect(place(s).placement).toBe('known');
    });
  });
});

describe('presentedBounds', () => {
  it('is the authored bounds plus the offset; null offset returns the bounds unchanged', () => {
    const b = { min: [1, 2, 3], max: [4, 5, 6] } as const;
    expect(presentedBounds(b, { x: 10, y: -2, z: 0.5 })).toEqual({ min: [11, 0, 3.5], max: [14, 3, 6.5] });
    expect(presentedBounds(b, null)).toBe(b);
  });
});
