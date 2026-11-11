/**
 * Edge cases found by a mutation sweep of toolpath-core: bounds/classifier clauses, builder ordering
 * and origin rebasing, source-map range guards, the time axis on non-finite input, and progress-mapper
 * boundaries. Expected values are literals, never the module's own constants.
 */
import { describe, expect, it } from 'vitest';
import {
  FeatureRole,
  MoveKind,
  ToolpathIRBuilder,
  buildSourceLineIndex,
  byteRangeOfLine,
  computeToolpathTime,
  createProgressMapper,
  sourceLineOfSegment,
  type ProgressObservation,
  type SegmentInput,
  type ToolpathIR
} from '../index';

/** A 40-digit G-code literal: finite as a double, Infinity once stored in a Float32 channel. */
const HUGE = Number('9'.repeat(40));

function seg(over: Partial<SegmentInput> & { x0: number; x1: number }): SegmentInput {
  return { y0: 0, z0: 0.2, y1: 0, z1: 0.2, e: 1, kind: MoveKind.Extrude, layer: 0, srcByte: 0, ...over };
}

function build(segs: SegmentInput[]): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (const s of segs) b.addSegment(s);
  return b.finalize();
}

describe('bounds', () => {
  it('extrude bounds track Z and exclude travel; travel-inclusive bounds do not', () => {
    const ir = build([
      seg({ x0: 0, x1: 10, z0: 0.2, z1: 0.6 }),
      seg({ x0: 10, x1: 50, kind: MoveKind.Travel, e: 0, srcByte: 10 })
    ]);
    expect(ir.bounds.min.z).toBeCloseTo(0.2, 5);
    expect(ir.bounds.max.z).toBeCloseTo(0.6, 5);
    expect(ir.bounds.max.x).toBeCloseTo(10, 5);
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(50, 5);
  });
});

describe('classifyModelBounds clauses', () => {
  it('membership on travel only does not make a file classifiable', () => {
    const ir = build([
      seg({ x0: 0, x1: 10, kind: MoveKind.Travel, e: 0, object: 1 }),
      seg({ x0: 10, x1: 20, object: 0, srcByte: 10 })
    ]);
    expect(ir.header.capabilities.nonModelClassification).toBe('unavailable');
  });

  it('model bounds track Z and exclude travel', () => {
    const ir = build([
      seg({ x0: 0, x1: 10, feature: FeatureRole.Skirt }),
      seg({ x0: 100, x1: 110, z0: 0.2, z1: 0.8, feature: FeatureRole.Perimeter, srcByte: 10 }),
      seg({ x0: 110, x1: 300, kind: MoveKind.Travel, e: 0, srcByte: 20 })
    ]);
    expect(ir.header.capabilities.nonModelClassification).toBe('inferred');
    expect(ir.modelBounds.min.x).toBeCloseTo(100, 5);
    expect(ir.modelBounds.max.x).toBeCloseTo(110, 5);
    expect(ir.modelBounds.max.z).toBeCloseTo(0.8, 5);
  });

  it('a purge line is housekeeping', () => {
    const ir = build([
      seg({ x0: 0, x1: 10, feature: FeatureRole.Purge }),
      seg({ x0: 100, x1: 110, feature: FeatureRole.Perimeter, srcByte: 10 })
    ]);
    expect(ir.header.capabilities.nonModelClassification).toBe('inferred');
    expect(ir.modelBounds.min.x).toBeCloseTo(100, 5);
  });
});

describe('ToolpathIRBuilder ordering and origin', () => {
  it('setTool info survives later segments on that tool; tools are sorted by id', () => {
    const b = new ToolpathIRBuilder();
    b.setTool({ id: 2, material: 'PETG' });
    b.addSegment(seg({ x0: 0, x1: 1, tool: 2 }));
    b.addSegment(seg({ x0: 1, x1: 2, tool: 1, srcByte: 10 }));
    const ir = b.finalize();
    expect(ir.tools).toEqual([{ id: 1 }, { id: 2, material: 'PETG' }]);
  });

  it('addObject returns 1-based indices', () => {
    const b = new ToolpathIRBuilder();
    expect(b.addObject({ id: 'a' })).toBe(1);
    expect(b.addObject({ id: 'b' })).toBe(2);
  });

  it('layers are ordered by index and take Z from the first segment end', () => {
    const ir = build([
      seg({ x0: 0, x1: 1, z0: 0.2, z1: 0.4, layer: 1 }),
      seg({ x0: 1, x1: 2, z0: 0.2, z1: 0.2, layer: 0, srcByte: 10 })
    ]);
    expect(ir.layers.map((l) => l.segStart)).toEqual([1, 0]);
    expect(ir.layers[1].z).toBeCloseTo(0.4, 5);
  });

  it('retraction and color-change positions are stored origin-relative', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg({ x0: 100, x1: 110, y0: 50, y1: 50 }));
    b.addRetraction({ x: 110, y: 50, z: 0.2, kind: 'retract', srcByte: 20, segIndex: 1 });
    b.addColorChange({ x: 105, y: 50, z: 0.2, segIndex: 1, srcByte: 30, tool: 0 });
    const ir = b.finalize();
    expect(ir.retractions[0].x).toBeCloseTo(10, 5);
    expect(ir.retractions[0].y).toBeCloseTo(0, 5);
    expect(ir.colorChanges[0].x).toBeCloseTo(5, 5);
  });

  it('events recorded before the first segment land in the same frame as the segments', () => {
    const b = new ToolpathIRBuilder();
    b.addRetraction({ x: 100, y: 50, z: 0.2, kind: 'retract', srcByte: 0, segIndex: 0 });
    b.addColorChange({ x: 100, y: 50, z: 0.2, segIndex: 0, srcByte: 5, tool: 0 });
    b.addSegment(seg({ x0: 100, x1: 110, y0: 50, y1: 50, srcByte: 10 }));
    const ir = b.finalize();
    // Absolute = originOffset + stored; both events sit at the segment start (100, 50).
    expect(ir.header.originOffset.x + ir.retractions[0].x).toBeCloseTo(100, 5);
    expect(ir.header.originOffset.y + ir.colorChanges[0].y).toBeCloseTo(50, 5);
    expect(ir.retractions[0].x).toBeCloseTo(0, 5);
  });
});

describe('source-map range guards', () => {
  const li = buildSourceLineIndex('G1 X1\nG1 X2\n');
  const srcByte = Uint32Array.from([0, 6]);

  it('line 0 is out of range', () => {
    expect(byteRangeOfLine(li, 0)).toBeNull();
  });

  it('segment indices -1 and count are out of range', () => {
    expect(sourceLineOfSegment(srcByte, li, -1)).toBeNull();
    expect(sourceLineOfSegment(srcByte, li, 2)).toBeNull();
    expect(sourceLineOfSegment(srcByte, li, 1)).toBe(2);
  });
});

describe('computeToolpathTime edges', () => {
  it('a Z-only move counts its Z length', () => {
    // 10 mm of Z at 600 mm/min = 1000 ms.
    const t = computeToolpathTime(build([seg({ x0: 0, x1: 0, z0: 0, z1: 10, feedrate: 600 })]));
    expect(t.totalMs).toBeCloseTo(1000, 3);
  });

  it('a zero-length move without a feedrate does not flag the estimate', () => {
    const t = computeToolpathTime(build([seg({ x0: 5, x1: 5 })]));
    expect(t.hasUnknownFeedrate).toBe(false);
    expect(t.totalMs).toBe(0);
  });

  it('an Infinity feedrate (Float32 overflow) contributes 0 and flags the estimate', () => {
    const t = computeToolpathTime(
      build([seg({ x0: 0, x1: 10, feedrate: 600 }), seg({ x0: 10, x1: 20, feedrate: HUGE, srcByte: 10 })])
    );
    expect(t.totalMs).toBe(1000);
    expect(t.hasUnknownFeedrate).toBe(true);
  });

  it('a coordinate beyond Float32 range never poisons the axis with NaN/Infinity', () => {
    const t = computeToolpathTime(
      build([
        seg({ x0: 0, x1: 10, feedrate: 600 }),
        seg({ x0: 10, x1: HUGE, feedrate: 600, srcByte: 10 }),
        seg({ x0: HUGE, x1: HUGE, y0: 0, y1: 10, feedrate: 600, srcByte: 20 }),
        seg({ x0: HUGE, x1: 20, feedrate: 600, srcByte: 30 }),
        seg({ x0: 20, x1: 30, feedrate: 600, srcByte: 40 })
      ])
    );
    expect(Array.from(t.cumulativeMs)).toEqual([1000, 1000, 1000, 1000, 2000]);
    expect(t.totalMs).toBe(2000);
    expect(t.hasUnknownFeedrate).toBe(true);
  });
});

/** 3 layers × 4 segments; srcByte = i * 100 + 10 (the progress.test.ts fixture). */
function progressIR(source?: { byteLength?: number; sha256?: string }): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known', source });
  for (let i = 0; i < 12; i++) {
    const layer = Math.floor(i / 4);
    b.addSegment(seg({ x0: i, x1: i + 1, z0: 0.2 * (layer + 1), z1: 0.2 * (layer + 1), layer, srcByte: i * 100 + 10 }));
  }
  return b.finalize();
}

function obs(position: ProgressObservation['position'], extra?: Partial<ProgressObservation>): ProgressObservation {
  return { v: 1, timestampMs: 1_000, position, ...extra };
}

describe('progress mapper boundaries', () => {
  it('a null or non-object observation is unavailable, never a throw', () => {
    const mapper = createProgressMapper(progressIR());
    for (const bad of [null, undefined, 42, 'x']) {
      const m = mapper.observe(bad as unknown as ProgressObservation);
      expect(m.confidence).toBe('unavailable');
      expect(m.notes.map((n) => n.code)).toEqual(['version-unsupported']);
    }
  });

  it('percent exactly 1 is valid and maps to the last segment', () => {
    expect(createProgressMapper(progressIR()).observe(obs({ percent: 1 })).segIndex).toBe(11);
  });

  it('a reported layer equal to the layer count clamps to the last layer', () => {
    const m = createProgressMapper(progressIR()).observe(obs({ layer: 3 }));
    expect(m.layerIndex).toBe(2);
    expect(m.segIndex).toBe(11);
  });

  it('the percent(bytes) band is clamped at segment 0', () => {
    // 0.01 × 1210 = 12 → segment 0; half-width ceil(12 × 0.005) = 1 → band [0, 1], never -1.
    const m = createProgressMapper(progressIR(), { fileSizeBytes: 1_210 }).observe(
      obs({ percent: 0.01, percentBasis: 'bytes' })
    );
    expect(m.segIndex).toBe(0);
    expect(m.band).toEqual([0, 1]);
  });

  it('a percent(bytes) cross-check before the first segment resolves to segment 0, never a throw', () => {
    // 0.001 × 1210 ≈ 1 → before the first segment byte (10) → implied segment 0, layer 0 (within 1 of 1).
    const m = createProgressMapper(progressIR(), { fileSizeBytes: 1_210 }).observe(
      obs({ layer: 1, percent: 0.001, percentBasis: 'bytes' })
    );
    expect(m.basis).toBe('layer');
    expect(m.band).toEqual([4, 7]);
  });

  it('an observed sha with no parsed sha is not a mismatch', () => {
    const m = createProgressMapper(progressIR()).observe(obs({ byte: 510 }, { file: { sha256: 'b'.repeat(64) } }));
    expect(m.confidence).toBe('known');
    expect(m.segIndex).toBe(5);
  });

  it('a size disagreement of exactly 0.1% is still a match', () => {
    const m = createProgressMapper(progressIR(), { fileSizeBytes: 1_000 }).observe(
      obs({ byte: 510 }, { file: { sizeBytes: 1_001 } })
    );
    expect(m.confidence).toBe('known');
    expect(m.notes.map((n) => n.code)).not.toContain('file-mismatch');
  });

  it('a demoted byte against a zero-size observed file is unavailable', () => {
    const m = createProgressMapper(progressIR({ byteLength: 1_210 })).observe(
      obs({ byte: 510 }, { file: { sizeBytes: 0 } })
    );
    expect(m.segIndex).toBeNull();
    expect(m.confidence).toBe('unavailable');
  });

  it('percent(bytes) after a size demotion is ordinal, not promoted through the untrusted size', () => {
    // Ordinal: round(0.5 × 11) = 6. Promotion through 2000 bytes would give byte 1000 → segment 9.
    const m = createProgressMapper(progressIR({ byteLength: 1_210 })).observe(
      obs({ percent: 0.5, percentBasis: 'bytes' }, { file: { sizeBytes: 2_000 } })
    );
    expect(m.segIndex).toBe(6);
  });

  it('complete with a byte fact reports the byte basis', () => {
    const m = createProgressMapper(progressIR()).observe(obs({ byte: 110 }, { state: 'complete' }));
    expect(m.basis).toBe('byte');
    expect(m.segIndex).toBe(11);
  });

  it('a totalLayers off by exactly 2 still trusts the layer index; totalLayers 0 is ignored', () => {
    for (const totalLayers of [5, 0]) {
      const m = createProgressMapper(progressIR()).observe(obs({ layer: 1, totalLayers }));
      expect(m.confidence).toBe('inferred');
      expect(m.band).toEqual([4, 7]);
    }
  });

  it('cancelled with no facts and no prior position keeps its own notes', () => {
    const m = createProgressMapper(progressIR()).observe({ v: 1, timestampMs: 1_000, state: 'cancelled' });
    expect(m.notes.map((n) => n.code)).toEqual(['no-position-facts', 'job-cancelled']);
  });

  it('repeated cancelled observations keep notes capped at 8', () => {
    const mapper = createProgressMapper(progressIR());
    mapper.observe(obs({ byte: 510 }));
    let m = mapper.observe({ v: 1, timestampMs: 1_000, state: 'cancelled' });
    for (let k = 0; k < 12; k++) m = mapper.observe({ v: 1, timestampMs: 1_000, state: 'cancelled' });
    expect(m.segIndex).toBe(5);
    expect(m.notes.length).toBe(8);
  });

  it('staleness is strictly after the threshold and recomputes if the clock goes back', () => {
    const mapper = createProgressMapper(progressIR(), { staleAfterMs: 1_000 });
    mapper.observe(obs({ byte: 510 })); // timestamp 1000
    expect(mapper.tick(2_000).stale).toBe(false);
    expect(mapper.tick(2_001).stale).toBe(true);
    expect(mapper.tick(1_500).stale).toBe(false);
  });
});
