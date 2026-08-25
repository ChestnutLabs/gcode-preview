/**
 * Phase-1 geometry-builder tests (DD-004 §4.3–§4.6, §11 — pure, Node-only).
 * Fixtures are hand-built through ToolpathIRBuilder (the package's one allowed
 * dependency) — the renderer never touches the parser.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { autoDecimation, buildChunks, buildChunkColors, computeDrawState, tubeRadialForBudget } from '../index.js';

/** Build an IR with `layers` layers × `perLayer` extrude segments (+1 travel between layers). */
function makeIR(layers: number, perLayer: number, tools = 1): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let y = 0;
  for (let l = 0; l < layers; l++) {
    const z = 0.2 * (l + 1);
    for (let s = 0; s < perLayer; s++) {
      b.addSegment({
        x0: s,
        y0: y,
        z0: z,
        x1: s + 1,
        y1: y,
        z1: z,
        e: 1,
        kind: MoveKind.Extrude,
        tool: l % tools,
        layer: l,
        srcByte: (l * perLayer + s) * 10
      });
    }
    if (l < layers - 1) {
      b.addSegment({
        x0: perLayer,
        y0: y,
        z0: z,
        x1: 0,
        y1: ++y,
        z1: z + 0.2,
        kind: MoveKind.Travel,
        tool: l % tools,
        layer: l,
        srcByte: (l * perLayer + perLayer) * 10
      });
    }
  }
  return b.finalize();
}

describe('buildChunks (§4.3/§4.4)', () => {
  it('copies positions verbatim from the IR SoA and preserves order', () => {
    const ir = makeIR(2, 3);
    const { chunks, decimationApplied, travelHidden } = buildChunks(ir);
    expect(decimationApplied).toBe(1);
    expect(travelHidden).toBe(false);

    const extrude = chunks.filter((c) => c.kind === 'extrude');
    const travel = chunks.filter((c) => c.kind === 'travel');
    expect(extrude.reduce((a, c) => a + c.count, 0)).toBe(6);
    expect(travel.reduce((a, c) => a + c.count, 0)).toBe(1);

    // First extrude segment: verbatim floats from the SoA.
    const c0 = extrude[0];
    expect(c0.positions[0]).toBe(ir.segments.x0[c0.segIndices[0]]);
    expect(c0.positions[3]).toBe(ir.segments.x1[c0.segIndices[0]]);
    // segIndices strictly ascending (IR order).
    for (let k = 1; k < c0.count; k++) {
      expect(c0.segIndices[k]).toBeGreaterThan(c0.segIndices[k - 1]);
    }
  });

  it('routes MoveKind.Wipe segments into their own chunk, separate from travel (DD-016, #182)', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    const common = { x0: 0, y0: 0, z0: 0.2, x1: 1, y1: 0, z1: 0.2, tool: 0, layer: 0 };
    b.addSegment({ ...common, e: 1, kind: MoveKind.Extrude, srcByte: 0 });
    b.addSegment({ ...common, kind: MoveKind.Travel, srcByte: 10 });
    // A wipe move: base Travel + the additive Wipe bit (as a slicer adapter would set it).
    b.addSegment({ ...common, kind: MoveKind.Travel | MoveKind.Wipe, srcByte: 20 });
    b.addSegment({ ...common, kind: MoveKind.Travel | MoveKind.Wipe, srcByte: 30 });
    const ir = b.finalize();

    const { chunks } = buildChunks(ir);
    const wipe = chunks.filter((c) => c.kind === 'wipe');
    const travel = chunks.filter((c) => c.kind === 'travel');
    expect(wipe.reduce((a, c) => a + c.count, 0)).toBe(2); // the two wipe moves
    expect(travel.reduce((a, c) => a + c.count, 0)).toBe(1); // the plain travel, NOT the wipe moves
    // The wipe chunk's segments really are the wipe-bit segments.
    const wipeIdx = wipe.flatMap((c) => Array.from(c.segIndices));
    for (const i of wipeIdx) expect(ir.segments.kind[i] & MoveKind.Wipe).toBe(MoveKind.Wipe);
  });

  it('splits chunks at layer boundaries around the target size', () => {
    const ir = makeIR(10, 100);
    const { chunks } = buildChunks(ir, { targetSegmentsPerChunk: 250 });
    const extrude = chunks.filter((c) => c.kind === 'extrude');
    expect(extrude.length).toBeGreaterThan(1);
    // Chunks are layer-aligned: consecutive chunks cover consecutive layer ranges.
    for (let i = 1; i < extrude.length; i++) {
      expect(extrude[i].layerStart).toBe(extrude[i - 1].layerEnd + 1);
    }
    // Every segment appears exactly once across chunks.
    const seen = new Set<number>();
    for (const c of chunks) for (const s of c.segIndices) seen.add(s);
    expect(seen.size).toBe(ir.segments.count);
  });

  it('decimation keeps every Nth extrusion segment PLUS layer boundaries, and hides travel', () => {
    const ir = makeIR(4, 50);
    const { chunks, decimationApplied, travelHidden, totalSegmentsIncluded } = buildChunks(ir, { decimation: 5 });
    expect(decimationApplied).toBe(5);
    expect(travelHidden).toBe(true);
    expect(chunks.every((c) => c.kind === 'extrude')).toBe(true);
    // Reduced but layer boundaries retained.
    expect(totalSegmentsIncluded).toBeLessThan(200);
    const kept = new Set<number>();
    for (const c of chunks) for (const s of c.segIndices) kept.add(s);
    // The honest boundary is the first/last EXTRUSION segment of each layer
    // (a layer's raw segEnd may be a travel move, hidden under decimation).
    for (const layer of ir.layers) {
      let first = -1;
      let last = -1;
      for (let i = layer.segStart; i <= layer.segEnd; i++) {
        if (ir.segments.kind[i] & MoveKind.Extrude) {
          if (first === -1) first = i;
          last = i;
        }
      }
      expect(kept.has(first), `first extrude of layer @${first}`).toBe(true);
      expect(kept.has(last), `last extrude of layer @${last}`).toBe(true);
    }
  });

  it('auto decimation follows the §4.4 provisional thresholds', () => {
    expect(autoDecimation(1_000_000)).toBe(1);
    expect(autoDecimation(3_000_000)).toBe(2);
    expect(autoDecimation(7_000_000)).toBe(3);
    expect(autoDecimation(12_000_000)).toBe(5);
  });

  it('tubeSegmentBudget bounds tube memory by decimating past the budget (RR-006)', () => {
    const ir = makeIR(10, 100); // 1000 extrude segments
    // Over budget → decimate so kept ≤ budget: ceil(1000 / 250) = 4.
    const over = buildChunks(ir, { decimation: 'auto', tubeSegmentBudget: 250 });
    expect(over.decimationApplied).toBe(4);
    expect(over.totalSegmentsIncluded).toBeLessThanOrEqual(250 + ir.layers.length * 2); // + always-kept boundaries
    // Under budget → no reduction (lines-mode behavior unchanged for small/normal files).
    const under = buildChunks(ir, { decimation: 'auto', tubeSegmentBudget: 5000 });
    expect(under.decimationApplied).toBe(1);
    // An explicit numeric decimation is a caller override — the budget never lowers it.
    const explicit = buildChunks(ir, { decimation: 2, tubeSegmentBudget: 250 });
    expect(explicit.decimationApplied).toBe(2);
    // Omitting the budget (lines mode) is unchanged.
    expect(buildChunks(ir, { decimation: 'auto' }).decimationApplied).toBe(1);
  });

  it('handles an empty IR', () => {
    const ir = new ToolpathIRBuilder().finalize();
    const { chunks, totalSegmentsIncluded } = buildChunks(ir);
    expect(chunks).toHaveLength(0);
    expect(totalSegmentsIncluded).toBe(0);
  });
});

describe('tubeRadialForBudget (RR-006 correction — coarsen the cross-section, never drop segments)', () => {
  it('keeps full cross-section for a small file', () => {
    expect(tubeRadialForBudget(100_000, 8)).toBe(8);
  });

  it('coarsens the cross-section (not the path) for a large file, down to the minimum', () => {
    // ~1.14 M segments → a reduced-but-still-round cross-section that fits the budget.
    const r = tubeRadialForBudget(1_140_000, 8);
    expect(r).toBeGreaterThanOrEqual(3);
    expect(r).toBeLessThan(8);
    // ~1.76 M (the Dragon) → the minimum cross-section, still continuous (no dropped segments).
    expect(tubeRadialForBudget(1_760_000, 8)).toBe(3);
  });

  it('returns null (→ lines fallback) only when even the minimum cross-section blows the budget', () => {
    expect(tubeRadialForBudget(3_000_000, 8)).toBeNull();
  });

  it('never returns below the minimum cross-section', () => {
    const r = tubeRadialForBudget(2_000_000, 8);
    expect(r === null || r >= 3).toBe(true);
  });
});

describe('buildChunkColors (§4.6)', () => {
  it('maps tool channel through the palette, both vertices identical', () => {
    const ir = makeIR(2, 2, 2); // alternating tools by layer
    const { chunks } = buildChunks(ir);
    const extrude = chunks.filter((c) => c.kind === 'extrude')[0];
    const colors = buildChunkColors(ir, extrude, {
      mode: 'tool',
      palette: [
        [1, 0, 0],
        [0, 1, 0]
      ]
    });
    expect(colors.length).toBe(extrude.count * 6);
    // Layer 0 segments are tool 0 -> red on both vertices.
    expect([colors[0], colors[1], colors[2]]).toEqual([1, 0, 0]);
    expect([colors[3], colors[4], colors[5]]).toEqual([1, 0, 0]);
  });

  it('feature mode: unknown feature (0) gets the fallback, never a fabricated role color', () => {
    const ir = makeIR(1, 3); // builder leaves feature = 0 (unknown)
    const { chunks } = buildChunks(ir);
    const colors = buildChunkColors(ir, chunks[0], {
      mode: 'feature',
      palette: [[0, 0, 1]],
      fallback: [0.5, 0.5, 0.5]
    });
    expect([colors[0], colors[1], colors[2]]).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('computeDrawState (§4.5)', () => {
  it('whole-chunk visibility outside/inside the layer range', () => {
    const ir = makeIR(10, 10);
    const { chunks } = buildChunks(ir, { targetSegmentsPerChunk: 30 });
    const extrude = chunks.filter((c) => c.kind === 'extrude');
    const first = extrude[0];
    // A range entirely after this chunk: invisible.
    const out = computeDrawState(ir, first, first.layerEnd + 1, 9);
    expect(out.visible).toBe(false);
    // A range covering the chunk fully: full draw.
    const full = computeDrawState(ir, first, 0, 9);
    expect(full).toEqual({ visible: true, drawStart: 0, drawCount: first.count });
  });

  it('trims boundary chunks by layer via binary search', () => {
    const ir = makeIR(6, 10);
    const { chunks } = buildChunks(ir, { targetSegmentsPerChunk: 100000 }); // one big chunk per kind
    const chunk = chunks.filter((c) => c.kind === 'extrude')[0];
    const state = computeDrawState(ir, chunk, 2, 3);
    // Exactly layers 2..3 of extrude segments: 20 segments.
    expect(state.visible).toBe(true);
    expect(state.drawCount).toBe(20);
    expect(ir.segments.layer[chunk.segIndices[state.drawStart]]).toBe(2);
  });

  it('scrub cutoff trims by IR segment index (the E5 overlay hook)', () => {
    const ir = makeIR(3, 10);
    const { chunks } = buildChunks(ir, { targetSegmentsPerChunk: 100000 });
    const chunk = chunks.filter((c) => c.kind === 'extrude')[0];
    // Scrub to the 5th segment of layer 0 (IR index 4).
    const state = computeDrawState(ir, chunk, 0, 2, 4);
    expect(state.drawStart).toBe(0);
    expect(state.drawCount).toBe(5);
    // Scrub before the chunk start: nothing drawn.
    const none = computeDrawState(ir, chunk, 1, 2, 3);
    expect(none.visible).toBe(false);
  });
});
