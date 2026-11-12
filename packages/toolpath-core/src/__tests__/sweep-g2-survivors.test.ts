import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, createProgressMapper, type SegmentInput, type ToolpathIR } from '../index';

/** Sweep G2: one test per mutant that survived the existing suites (see the PR body for the list). */

function seg(layer: number, z: number, srcByte: number, extra: Partial<SegmentInput> = {}): SegmentInput {
  return {
    x0: 10,
    y0: 20,
    z0: z,
    x1: 11,
    y1: 20,
    z1: z,
    e: 1,
    feedrate: 600,
    kind: MoveKind.Extrude,
    layer,
    srcByte,
    ...extra
  };
}

/** Ten segments, two layers (0..4 at z 0.2, 5..9 at z 0.4), srcByte 0, 100, ... 900. */
function twoLayerIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({ source: { byteLength: 1000 } });
  for (let i = 0; i < 10; i++) b.addSegment(seg(i < 5 ? 0 : 1, i < 5 ? 0.2 : 0.4, i * 100));
  return b.finalize();
}

describe('builder defaults and frame (B16, B20, B23, D05)', () => {
  it('an omitted extrusion delta is stored as 0', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg(0, 0.2, 0, { e: undefined, kind: MoveKind.Travel }));
    expect(b.finalize().segments.e[0]).toBe(0);
  });

  it('retraction Z is rebased into the origin frame', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg(0, 5, 0)); // origin = (10, 20, 5)
    b.addRetraction({ x: 12, y: 21, z: 7, kind: 'retract', srcByte: 0, segIndex: 0 });
    expect(b.finalize().retractions).toEqual([{ x: 2, y: 1, z: 2, kind: 'retract', srcByte: 0, segIndex: 0 }]);
  });

  it('an empty build has origin (0, 0, 0) and events stay absolute', () => {
    const b = new ToolpathIRBuilder();
    b.addColorChange({ x: 1, y: 2, z: 3, segIndex: 0, srcByte: 0, tool: 0 });
    const ir = b.finalize();
    expect(ir.header.originOffset).toEqual({ x: 0, y: 0, z: 0 });
    expect(ir.colorChanges).toEqual([{ x: 1, y: 2, z: 3, segIndex: 0, srcByte: 0, tool: 0 }]);
  });

  it('boundsWithTravel includes the first segment start point', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment({ x0: 0, y0: 0, z0: 0, x1: 10, y1: 5, z1: 1, kind: MoveKind.Travel, layer: 0, srcByte: 0 });
    expect(b.finalize().boundsWithTravel).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 1 } });
  });
});

describe('progress mapper edges (P14, P26, P29, P31, P34)', () => {
  it('a 0.5 % file-size disagreement demotes the byte domain', () => {
    const m = createProgressMapper(twoLayerIR(), { fileSizeBytes: 10_000 });
    const r = m.observe({ v: 1, timestampMs: 0, file: { sizeBytes: 10_050 }, position: { byte: 500 } });
    expect(r.notes).toEqual([{ code: 'file-mismatch', message: 'sizeBytes 10050 vs parsed 10000' }]);
    expect(r.confidence).toBe('approximated');
  });

  it('a 0.1 % disagreement is within tolerance (exact byte mapping)', () => {
    const m = createProgressMapper(twoLayerIR(), { fileSizeBytes: 10_000 });
    const r = m.observe({ v: 1, timestampMs: 0, file: { sizeBytes: 10_010 }, position: { byte: 500 } });
    expect(r.notes).toEqual([]);
    expect(r).toMatchObject({ segIndex: 5, confidence: 'known', band: [5, 5] });
  });

  it('only invalid fields: the invalid-field note, without no-position-facts', () => {
    const m = createProgressMapper(twoLayerIR());
    const r = m.observe({ v: 1, timestampMs: 0, position: { percent: NaN } });
    expect(r.notes).toEqual([{ code: 'invalid-field', message: 'position.percent ignored' }]);
    expect(r.basis).toBe('none');
  });

  it('a non-finite timestamp disables staleness rather than poisoning it', () => {
    const m = createProgressMapper(twoLayerIR());
    m.observe({ v: 1, timestampMs: -Infinity, position: { byte: 500 } });
    expect(m.tick(1e12).stale).toBe(false);
  });

  it('tick before any observation stays unavailable and not stale', () => {
    const m = createProgressMapper(twoLayerIR());
    expect(m.tick(20_000)).toMatchObject({ segIndex: null, basis: 'none', stale: false });
  });

  it('an empty IR is unavailable with the empty-ir note for any position', () => {
    const m = createProgressMapper(new ToolpathIRBuilder().finalize());
    for (const position of [{ percent: 0.5 }, { layer: 0 }, { byte: 0 }]) {
      expect(m.observe({ v: 1, timestampMs: 0, position })).toEqual({
        segIndex: null,
        basis: 'none',
        confidence: 'unavailable',
        band: null,
        layerIndex: null,
        stale: false,
        notes: [{ code: 'empty-ir' }]
      });
    }
  });
});

describe('progress mapper on an IR with segments but no layers (P35, P37)', () => {
  // The parser emits `layers: []` with segments when it clears layers (non-planar file).
  const noLayers = (): ToolpathIR => ({ ...twoLayerIR(), layers: [] });

  it('a layer-only observation falls through to no-position-facts (never indexes layers[-1])', () => {
    const r = createProgressMapper(noLayers()).observe({ v: 1, timestampMs: 0, position: { layer: 3 } });
    expect(r).toMatchObject({ segIndex: null, basis: 'none', confidence: 'unavailable' });
    expect(r.notes).toEqual([{ code: 'no-position-facts' }]);
  });

  it('byte + layer skips the cross-check instead of throwing', () => {
    const r = createProgressMapper(noLayers()).observe({ v: 1, timestampMs: 0, position: { byte: 500, layer: 0 } });
    expect(r).toMatchObject({ segIndex: 5, basis: 'byte', confidence: 'known', band: [5, 5], layerIndex: 1 });
    expect(r.notes).toEqual([]);
  });
});
