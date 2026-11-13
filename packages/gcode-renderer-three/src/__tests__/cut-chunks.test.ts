/**
 * #584 — CNC/laser Cut segments are their own chunk kind (not travel), thinned by decimation like Extrude
 * (boundary or every Nth) instead of vanishing with travel, and never counted toward autoDecimation.
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

  it('does not count cuts toward autoDecimation (extrude-only, this change)', () => {
    // >2M cuts would force auto-decimation if counted; it must stay 1 and keep them all.
    const r = buildChunks(makeIR(2_100_000, 0, 1));
    expect(r.decimationApplied).toBe(1);
    expect(total(r, 'cut')).toBe(2_100_000);
  }, 60_000);

  it('leaves an FDM-only IR with no cut chunk', () => {
    const r = buildChunks(makeIR(0, 2, 5));
    expect(r.chunks.some((c) => c.kind === 'cut')).toBe(false);
    expect(total(r, 'extrude')).toBe(5);
    expect(total(r, 'travel')).toBe(2);
  });
});
