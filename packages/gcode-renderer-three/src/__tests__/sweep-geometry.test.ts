/**
 * Mutation-sweep tests for chunking, tube geometry and draw ranges (renderer-three). Every expectation is
 * a literal value worked out by hand (not read back from the module's own constants).
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { autoDecimation, buildChunks, buildTubeChunk, type GeometryChunk } from '../index.js';
import { computeDrawState, computeOverlayDrawStates } from '../ranges.js';
import { tubeRadialForBudget, tubeSegmentBytes } from '../tubes.js';

function irOf(layers: Array<Array<number>>): ToolpathIR {
  // Each inner array is one layer; each entry is a MoveKind. Segments are disjoint 1 mm steps along +x.
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let n = 0;
  layers.forEach((kinds, layer) => {
    for (const kind of kinds) {
      b.addSegment({
        x0: n * 2,
        y0: 0,
        z0: 0.2 * (layer + 1),
        x1: n * 2 + 1,
        y1: 0,
        z1: 0.2 * (layer + 1),
        e: kind === MoveKind.Extrude ? 1 : 0,
        kind,
        layer,
        srcByte: n * 10
      });
      n++;
    }
  });
  return b.finalize();
}
const E = MoveKind.Extrude;
const extrudes = (n: number): number[] => new Array<number>(n).fill(E);

describe('autoDecimation thresholds are exclusive at each boundary', () => {
  it.each([
    [2_000_000, 1],
    [2_000_001, 2],
    [5_000_000, 2],
    [5_000_001, 3],
    [10_000_000, 3],
    [10_000_001, 5]
  ])('%i extrude segments → %i', (count, expected) => {
    expect(autoDecimation(count)).toBe(expected);
  });
});

describe('buildChunks: tubeSegmentBudget, chunk closing, wipe counting', () => {
  it('raises decimation to ceil(extrude / budget): 10 segments, budget 4 → 3', () => {
    const r = buildChunks(irOf([extrudes(10)]), { tubeSegmentBudget: 4 });
    expect(r.decimationApplied).toBe(3);
  });
  it('a budget of 0 is ignored (decimation stays 1)', () => {
    expect(buildChunks(irOf([extrudes(10)]), { tubeSegmentBudget: 0 }).decimationApplied).toBe(1);
  });
  it('closes a chunk as soon as it holds `target` segments (>=, not >)', () => {
    const r = buildChunks(irOf([extrudes(2), extrudes(2), extrudes(2)]), { targetSegmentsPerChunk: 2 });
    expect(r.chunks.map((c) => [c.layerStart, c.layerEnd, c.count])).toEqual([
      [0, 0, 2],
      [1, 1, 2],
      [2, 2, 2]
    ]);
  });
  it('wipe segments count toward the chunk target', () => {
    const W = MoveKind.Wipe;
    const r = buildChunks(irOf([[W], [W], [W]]), { targetSegmentsPerChunk: 1 });
    expect(r.chunks.map((c) => [c.kind, c.layerStart, c.layerEnd, c.count])).toEqual([
      ['wipe', 0, 0, 1],
      ['wipe', 1, 1, 1],
      ['wipe', 2, 2, 1]
    ]);
  });
  it('the default target is 250 000: a layer of exactly 250 000 closes its chunk', () => {
    const r = buildChunks(irOf([extrudes(250_000), extrudes(1)]));
    expect(r.chunks.map((c) => [c.layerStart, c.layerEnd, c.count])).toEqual([
      [0, 0, 250_000],
      [1, 1, 1]
    ]);
  });
  it('under decimation the first and last extrusion of each layer are kept', () => {
    const r = buildChunks(irOf([extrudes(7), extrudes(7)]), { decimation: 3 });
    // indices 0..6 and 7..13; every 3rd (0,3,6,9,12) plus layer ends (0,6,7,13) → 0,3,6,7,9,12,13
    expect([...r.chunks[0].segIndices]).toEqual([0, 3, 6, 7, 9, 12, 13]);
  });
  it('under decimation, a layer start/end that is not a multiple of N is still kept', () => {
    const r = buildChunks(irOf([extrudes(4), extrudes(4)]), { decimation: 5 });
    // multiples of 5: 0,5; layer boundaries: 0,3 and 4,7 → 0,3,4,5,7
    expect([...r.chunks[0].segIndices]).toEqual([0, 3, 4, 5, 7]);
  });
});

describe('tube budget arithmetic', () => {
  it('tubeSegmentBytes(8) is 552 (9 ring vertices × 40 bytes + 48 indices × 4)', () => {
    expect(tubeSegmentBytes(8)).toBe(552);
    expect(tubeSegmentBytes(3)).toBe(4 * 40 + 18 * 4);
  });
  it('a budget that exactly fits the requested cross-section keeps it; one byte less coarsens by one side', () => {
    expect(tubeRadialForBudget(10, 8, 5520)).toBe(8);
    expect(tubeRadialForBudget(10, 8, 5519)).toBe(7);
  });
  it('the minimum 3-sided tube is accepted at an exactly-fitting budget, null one byte below', () => {
    expect(tubeRadialForBudget(10, 3, 10 * 232)).toBe(3);
    expect(tubeRadialForBudget(10, 3, 10 * 232 - 1)).toBeNull();
    expect(tubeRadialForBudget(10, 8, 10 * 232 - 1)).toBeNull();
  });
});

function chunkOf(...segs: number[][]): GeometryChunk {
  return {
    kind: 'extrude',
    layerStart: 0,
    layerEnd: 0,
    count: segs.length,
    positions: new Float32Array(segs.flat()),
    segIndices: new Uint32Array(segs.map((_, i) => i))
  };
}
const span = (pos: Float32Array, axis: 0 | 1 | 2): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = axis; i < pos.length; i += 3) {
    lo = Math.min(lo, pos[i]);
    hi = Math.max(hi, pos[i]);
  }
  return [lo, hi];
};

describe('buildTubeChunk geometry (literal)', () => {
  it('splits polylines on ANY endpoint mismatch: x, y or z alone starts a new run (rings = segs + runs)', () => {
    // radial 3 → 4 vertices per ring. Continuous: 3 rings → 12. Broken: 4 rings → 16.
    const o = { radialSegments: 3 };
    expect(buildTubeChunk(chunkOf([0, 0, 0, 1, 0, 0], [1, 0, 0, 2, 0, 0]), o).vertexCount).toBe(12);
    expect(buildTubeChunk(chunkOf([0, 0, 0, 1, 0, 0], [1.5, 0, 0, 2, 0, 0]), o).vertexCount).toBe(16);
    expect(buildTubeChunk(chunkOf([0, 0, 0, 1, 0, 0], [1, 0.5, 0, 2, 0, 0]), o).vertexCount).toBe(16);
    expect(buildTubeChunk(chunkOf([0, 0, 0, 1, 0, 0], [1, 0, 0.5, 2, 0, 0]), o).vertexCount).toBe(16);
  });
  it('vertex budget is exclusive: needing exactly maxVertices passes, one more throws', () => {
    const c = chunkOf([0, 0, 0, 1, 0, 0]); // radial 3: 2 rings × 4 = 8 vertices
    expect(buildTubeChunk(c, { radialSegments: 3, maxVertices: 8 }).vertexCount).toBe(8);
    expect(() => buildTubeChunk(c, { radialSegments: 3, maxVertices: 7 })).toThrow(
      'tube geometry needs 8 vertices (> budget 7); use lines mode for this chunk'
    );
  });
  it('the default vertex budget is 8 000 000', () => {
    const n = 1_000_000;
    const positions = new Float32Array(n * 6); // all-zero, continuous → (n + 1) rings × 9 vertices = 9 000 009
    const c: GeometryChunk = {
      kind: 'extrude',
      layerStart: 0,
      layerEnd: 0,
      count: n,
      positions,
      segIndices: new Uint32Array(0)
    };
    expect(() => buildTubeChunk(c)).toThrow(
      'tube geometry needs 9000009 vertices (> budget 8000000); use lines mode for this chunk'
    );
  });
  it('defaults: 8 sides, 0.6 mm wide, 0.2 mm high, top face at the path height (segment along +x)', () => {
    const t = buildTubeChunk(chunkOf([0, 0, 0, 1, 0, 0]));
    expect(t.vertexCount).toBe(18); // 2 rings × 9
    expect(t.indicesPerSegment).toBe(48);
    const [y0, y1] = span(t.positions, 1);
    const [z0, z1] = span(t.positions, 2);
    expect(y0).toBeCloseTo(-0.3, 5);
    expect(y1).toBeCloseTo(0.3, 5);
    expect(z0).toBeCloseTo(-0.2, 5);
    expect(z1).toBeCloseTo(0, 5);
  });
  it('width acts on the horizontal axis perpendicular to the path (segment along +y → x spans ±0.3)', () => {
    const t = buildTubeChunk(chunkOf([0, 0, 0, 0, 1, 0]));
    const [x0, x1] = span(t.positions, 0);
    expect(x0).toBeCloseTo(-0.3, 5);
    expect(x1).toBeCloseTo(0.3, 5);
  });
  it('custom width/height are honoured', () => {
    const t = buildTubeChunk(chunkOf([0, 0, 0, 1, 0, 0]), { lineWidth: 1, lineHeight: 0.4 });
    const [y0, y1] = span(t.positions, 1);
    const [z0, z1] = span(t.positions, 2);
    expect([y0, y1].map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.5, 0.5]);
    expect([z0, z1].map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.4, 0]);
  });
  it('a zero-length segment still gets a real ring (stable fallback tangent), not a collapsed point', () => {
    const t = buildTubeChunk(chunkOf([1, 1, 1, 1, 1, 1]), { radialSegments: 3 });
    const [y0, y1] = span(t.positions, 1);
    const [z0, z1] = span(t.positions, 2);
    expect(Math.max(y1 - y0, z1 - z0)).toBeGreaterThan(0.1);
  });
});

describe('draw ranges (layer clip + scrub + overlay), literal values', () => {
  // 4 layers × 4 extrusions: segment i is in layer floor(i / 4). One chunk covers layers 0..3 (16 segments).
  const ir = irOf([extrudes(4), extrudes(4), extrudes(4), extrudes(4)]);
  const whole = buildChunks(ir).chunks[0];
  const halves = buildChunks(ir, { targetSegmentsPerChunk: 8 }).chunks; // layers 0-1 and 2-3

  it('layer clip maps to [start, count) literal ranges', () => {
    expect(computeDrawState(ir, whole, 1, 2)).toEqual({ visible: true, drawStart: 4, drawCount: 8 });
    expect(computeDrawState(ir, whole, 0, 3)).toEqual({ visible: true, drawStart: 0, drawCount: 16 });
  });
  it('a chunk whose first layer equals endLayer is visible (>, not >=)', () => {
    expect(halves[1].layerStart).toBe(2);
    expect(computeDrawState(ir, halves[1], 0, 2)).toEqual({ visible: true, drawStart: 0, drawCount: 4 });
  });
  it('a chunk whose last layer equals startLayer is visible; one layer beyond is hidden', () => {
    expect(computeDrawState(ir, halves[0], 1, 3)).toEqual({ visible: true, drawStart: 4, drawCount: 4 });
    expect(computeDrawState(ir, halves[0], 2, 3)).toEqual({ visible: false, drawStart: 0, drawCount: 0 });
  });
  it('an inverted layer range draws nothing and never reports a negative count', () => {
    expect(computeDrawState(ir, whole, 3, 1)).toEqual({ visible: false, drawStart: 12, drawCount: 0 });
  });
  it('scrub beyond the layer-range end does not extend the range; scrub inside shortens it', () => {
    expect(computeDrawState(ir, whole, 0, 1, 15)).toEqual({ visible: true, drawStart: 0, drawCount: 8 });
    expect(computeDrawState(ir, whole, 0, 1, 5)).toEqual({ visible: true, drawStart: 0, drawCount: 6 });
    expect(computeDrawState(ir, whole, 0, 3, 0)).toEqual({ visible: true, drawStart: 0, drawCount: 1 });
    expect(computeDrawState(ir, whole, 0, 3, -1)).toEqual({ visible: false, drawStart: 0, drawCount: 0 });
  });

  it('overlay: completed / band / ghost split around the progress position', () => {
    const o = computeOverlayDrawStates(ir, whole, 0, 3, 3, 7);
    expect(o.completed).toEqual({ visible: true, drawStart: 0, drawCount: 4 });
    expect(o.band).toEqual({ visible: true, drawStart: 4, drawCount: 4 });
    expect(o.ghost).toEqual({ visible: true, drawStart: 8, drawCount: 8 });
  });
  it('overlay: at the very end the ghost is empty; with lo == hi the band is empty', () => {
    const end = computeOverlayDrawStates(ir, whole, 0, 3, 15, 15);
    expect(end.band).toEqual({ visible: false, drawStart: 16, drawCount: 0 });
    expect(end.ghost).toEqual({ visible: false, drawStart: 16, drawCount: 0 });
    expect(end.completed).toEqual({ visible: true, drawStart: 0, drawCount: 16 });
  });
  it('overlay: nothing completed yet (loSeg = -1) → everything after the band is ghost', () => {
    const o = computeOverlayDrawStates(ir, whole, 0, 3, -1, -1);
    expect(o.completed).toEqual({ visible: false, drawStart: 0, drawCount: 0 });
    expect(o.band).toEqual({ visible: false, drawStart: 0, drawCount: 0 });
    expect(o.ghost).toEqual({ visible: true, drawStart: 0, drawCount: 16 });
  });
  it('overlay: an inverted band (loSeg > hiSeg) has a zero count, never a negative one', () => {
    const o = computeOverlayDrawStates(ir, whole, 0, 3, 10, 5);
    expect(o.band).toEqual({ visible: false, drawStart: 11, drawCount: 0 });
    expect(o.ghost).toEqual({ visible: true, drawStart: 6, drawCount: 10 });
  });
  it('overlay: a chunk outside the layer range reports three zeroed states (drawStart 0)', () => {
    const o = computeOverlayDrawStates(ir, whole, 3, 1, 5, 6);
    const zero = { visible: false, drawStart: 0, drawCount: 0 };
    expect(o).toEqual({ completed: zero, band: zero, ghost: zero });
  });
});
