/**
 * #584 — CNC/laser Cut segments are their own chunk kind (not travel), thinned by decimation like Extrude
 * (boundary or every Nth) instead of vanishing with travel, and counted toward autoDecimation.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { buildChunks } from '../index.js';

/** One layer: `cuts` Cut segments, then `travels` Travel segments, then `extrudes` Extrude segments. */
function makeIR(cuts: number, travels: number, extrudes: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let n = 0;
  const add = (kind: number, e: number): void => {
    b.addSegment({ x0: n, y0: 0, z0: 0, x1: n + 1, y1: 0, z1: 0, e, kind, tool: 0, layer: 0, srcByte: n * 10 });
    n++;
  };
  for (let i = 0; i < cuts; i++) add(MoveKind.Cut, 0);
  for (let i = 0; i < travels; i++) add(MoveKind.Travel, 0);
  for (let i = 0; i < extrudes; i++) add(MoveKind.Extrude, 1);
  return b.finalize();
}

/**
 * A full-size IR without the builder's per-segment cost: typed arrays filled directly (cuts, then travels, then
 * extrudes, one layer). Coordinates stay 0 (finite). Keeps the 2M-segment threshold tests fast.
 */
function bigIR(cuts: number, travels: number, extrudes: number, cutKind: number = MoveKind.Cut): ToolpathIR {
  const base = makeIR(1, 0, 0);
  const n = cuts + travels + extrudes;
  const kind = new Uint8Array(n);
  kind.fill(cutKind, 0, cuts);
  kind.fill(MoveKind.Travel, cuts, cuts + travels);
  kind.fill(MoveKind.Extrude, cuts + travels, n);
  const segments = { ...base.segments, count: n, kind } as ToolpathIR['segments'];
  for (const key of ['x0', 'y0', 'z0', 'x1', 'y1', 'z1'] as const) segments[key] = new Float32Array(n);
  return { ...base, segments, layers: [{ ...base.layers[0], segStart: 0, segEnd: n - 1 }] };
}

const total = (r: ReturnType<typeof buildChunks>, kind: string): number =>
  r.chunks.filter((c) => c.kind === kind).reduce((a, c) => a + c.count, 0);

describe('buildChunks Cut kind (#584)', () => {
  it('puts Cut in its own chunk, not the travel chunk', () => {
    const r = buildChunks(makeIR(4, 2, 0));
    expect(total(r, 'cut')).toBe(4);
    expect(total(r, 'travel')).toBe(2);
    expect(total(r, 'extrude')).toBe(0);
    expect(r.totalSegmentsIncluded).toBe(6);
  });

  it('keeps every cut at decimation 1', () => {
    expect(total(buildChunks(makeIR(10, 0, 0), { decimation: 1 }), 'cut')).toBe(10);
  });

  it('thins cuts under decimation (boundary + every Nth) while travel is dropped', () => {
    // 10 cuts at indices 0..9, decimation 4 → kept: 0 and 9 (layer boundary), 4, 8 (i % 4 === 0).
    const r = buildChunks(makeIR(10, 3, 0), { decimation: 4 });
    expect(r.travelHidden).toBe(true);
    expect(total(r, 'travel')).toBe(0);
    const cut = r.chunks.filter((c) => c.kind === 'cut');
    expect(cut.flatMap((c) => Array.from(c.segIndices))).toEqual([0, 4, 8, 9]);
  });

  it('always keeps the first cut of a layer, even when it is not an Nth segment', () => {
    // A travel at index 0, then cuts at 1..9; decimation 4 → kept: 1 and 9 (first/last cut), 4 and 8 (every 4th).
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    for (let n = 0; n < 10; n++) {
      const kind = n === 0 ? MoveKind.Travel : MoveKind.Cut;
      b.addSegment({ x0: n, y0: 0, z0: 0, x1: n + 1, y1: 0, z1: 0, e: 0, kind, tool: 0, layer: 0, srcByte: n * 10 });
    }
    const r = buildChunks(b.finalize(), { decimation: 4 });
    const cut = r.chunks.filter((c) => c.kind === 'cut');
    expect(cut.flatMap((c) => Array.from(c.segIndices))).toEqual([1, 4, 8, 9]);
  });

  // Real CNC data carries Cut with other bits set (mach3: 169 of 177 cuts are arcs). Literal values, not the constants.
  it.each([
    ['Cut|ArcSegment', 160],
    ['Cut|Seam', 192]
  ])('routes %s (%i) to the cut chunk and keeps its layer boundary under decimation', (_name, kind) => {
    expect(kind).toBe(_name === 'Cut|ArcSegment' ? MoveKind.Cut | MoveKind.ArcSegment : MoveKind.Cut | MoveKind.Seam);
    // A travel at index 0, then flagged cuts at 1..9 in one layer.
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    for (let n = 0; n < 10; n++) {
      b.addSegment({
        x0: n,
        y0: 0,
        z0: 0,
        x1: n + 1,
        y1: 0,
        z1: 0,
        e: 0,
        kind: n === 0 ? MoveKind.Travel : kind,
        tool: 0,
        layer: 0,
        srcByte: n * 10
      });
    }
    const ir = b.finalize();
    const full = buildChunks(ir, { decimation: 1 });
    expect(total(full, 'cut')).toBe(9);
    expect(total(full, 'travel')).toBe(1);
    // Decimation 4: first (1) and last (9) cut of the layer are boundaries, plus every 4th (4, 8); travel dropped.
    const thin = buildChunks(ir, { decimation: 4 });
    expect(thin.chunks.filter((c) => c.kind === 'cut').flatMap((c) => Array.from(c.segIndices))).toEqual([1, 4, 8, 9]);
    expect(total(thin, 'travel')).toBe(0);
  });

  it('counts cuts toward autoDecimation: a 2.1M-cut file is thinned to every 2nd cut + the layer boundary', () => {
    const r = buildChunks(bigIR(2_100_000, 3, 0));
    expect(r.decimationApplied).toBe(2);
    expect(r.travelHidden).toBe(true);
    expect(total(r, 'travel')).toBe(0);
    // evens 0..2_099_998 = 1_050_000, plus the last cut 2_099_999 (layer boundary).
    expect(total(r, 'cut')).toBe(1_050_001);
    expect(r.totalSegmentsIncluded).toBe(1_050_001);
  }, 60_000);

  // Real CNC files are mostly arcs (mach3: 169 of 177 cuts are 160): an exact-kind count would never thin them.
  it.each([
    ['Cut|ArcSegment', 160],
    ['Cut|Seam', 192]
  ])(
    'counts %s (%i) cuts toward autoDecimation',
    (_name, kind) => {
      const r = buildChunks(bigIR(2_100_000, 0, 0, kind));
      expect(r.decimationApplied).toBe(2);
      expect(total(r, 'cut')).toBe(1_050_001);
    },
    60_000
  );

  it('counts an extruding arc (Extrude|ArcSegment, 33) toward autoDecimation', () => {
    const ir = bigIR(0, 0, 2_100_000);
    ir.segments.kind.fill(33);
    expect(buildChunks(ir).decimationApplied).toBe(2);
  }, 60_000);

  it('does not count a non-finite cut toward the threshold (2,000,001 cuts, one NaN, stays at 1)', () => {
    const ir = bigIR(2_000_001, 0, 0);
    ir.segments.x1[5] = Number.NaN;
    const r = buildChunks(ir);
    expect(r.skippedNonFinite).toBe(1);
    expect(r.decimationApplied).toBe(1);
    expect(total(r, 'cut')).toBe(2_000_000);
  }, 60_000);

  it('keeps every cut at the auto threshold edge (2,000,000) and keeps travel', () => {
    const r = buildChunks(bigIR(2_000_000, 2, 0));
    expect(r.decimationApplied).toBe(1);
    expect(r.travelHidden).toBe(false);
    expect(total(r, 'cut')).toBe(2_000_000);
    expect(total(r, 'travel')).toBe(2);
  }, 60_000);

  it('sums Cut and Extrude toward the threshold', () => {
    expect(buildChunks(bigIR(1_000_001, 0, 1_000_000)).decimationApplied).toBe(2);
  }, 60_000);

  it('keeps the tube budget Extrude-only: cuts never raise decimation through it', () => {
    expect(buildChunks(makeIR(10, 0, 0), { tubeSegmentBudget: 4 }).decimationApplied).toBe(1);
    // 10 extrudes over a budget of 4 still raise it (ceil(10 / 4) = 3), with cuts present too.
    expect(buildChunks(makeIR(10, 0, 10), { tubeSegmentBudget: 4 }).decimationApplied).toBe(3);
  });

  it('does not count non-finite cuts toward the threshold', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    for (let n = 0; n < 4; n++) {
      b.addSegment({
        x0: n,
        y0: 0,
        z0: 0,
        x1: n === 1 ? NaN : n + 1,
        y1: 0,
        z1: 0,
        e: 0,
        kind: MoveKind.Cut,
        tool: 0,
        layer: 0,
        srcByte: n
      });
    }
    const r = buildChunks(b.finalize());
    expect(r.skippedNonFinite).toBe(1);
    expect(r.decimationApplied).toBe(1);
    expect(total(r, 'cut')).toBe(3);
  });

  it('leaves an FDM-only IR with no cut chunk', () => {
    const r = buildChunks(makeIR(0, 2, 5));
    expect(r.chunks.some((c) => c.kind === 'cut')).toBe(false);
    expect(total(r, 'extrude')).toBe(5);
    expect(total(r, 'travel')).toBe(2);
  });
});
