/**
 * Survivors of the G1 mutation sweep of toolpath-core's ir / bounds / classify / source-map /
 * source-index files. Expected values are literals, never the module's own constants — the wire
 * constants in particular cross the worker boundary and reach consumers as plain numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  FeatureRole,
  IR_SCHEMA_VERSION,
  MoveKind,
  ToolpathIRBuilder,
  buildSourceIndex,
  buildSourceLineIndex,
  byteRangeOfLine,
  emptyBounds,
  isHousekeepingRole,
  segmentAtSourceLine,
  type SegmentInput,
  type ToolpathIR
} from '../index';

function build(segs: Array<Partial<SegmentInput> & { x0: number; x1: number }>): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  segs.forEach((s, i) =>
    b.addSegment({ y0: 0, z0: 0.2, y1: 0, z1: 0.2, e: 1, kind: 1 /* Extrude */, layer: 0, srcByte: i * 10, ...s })
  );
  return b.finalize();
}

const EMPTY = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };

describe('wire constants (I01, I06–I08)', () => {
  it('the IR schema version is 1 and stamped on the header', () => {
    expect(IR_SCHEMA_VERSION).toBe(1);
    expect(build([{ x0: 0, x1: 1 }]).header.irSchemaVersion).toBe(1);
  });

  it('MoveKind bit values are fixed', () => {
    expect({ ...MoveKind }).toEqual({
      None: 0,
      Extrude: 1,
      Travel: 2,
      Retract: 4,
      Unretract: 8,
      Wipe: 16,
      ArcSegment: 32,
      Seam: 64,
      Cut: 128
    });
  });

  it('FeatureRole codes are fixed', () => {
    expect({ ...FeatureRole }).toEqual({
      Unknown: 0,
      Perimeter: 1,
      ExternalPerimeter: 2,
      Infill: 3,
      SolidInfill: 4,
      Support: 5,
      Skirt: 6,
      Brim: 7,
      Bridge: 8,
      Travel: 9,
      Custom: 10,
      PrimeTower: 11,
      WipeTower: 12,
      Raft: 13,
      Purge: 14
    });
  });
});

describe('empty bounds (B02)', () => {
  it('emptyBounds is +Infinity min / -Infinity max on every axis', () => {
    expect(emptyBounds()).toEqual(EMPTY);
  });

  it('an IR with no extrusion has empty bounds, object bounds and model bounds', () => {
    const ir = build([{ x0: 0, x1: 10, z0: -1, z1: -2, kind: 2 /* Travel */, e: 0 }]);
    expect(ir.bounds).toEqual(EMPTY);
    expect(ir.objectBounds).toEqual(EMPTY);
    expect(ir.modelBounds).toEqual(EMPTY);
    expect(ir.boundsWithTravel.max.z).toBeCloseTo(-1, 5);
  });
});

describe('housekeeping roles (C02–C04, C06)', () => {
  // Support 5, Skirt 6, Brim 7, PrimeTower 11, WipeTower 12, Raft 13, Purge 14.
  it.each([5, 6, 7, 11, 12, 13, 14])('role %i is housekeeping and excluded from model bounds', (role) => {
    expect(isHousekeepingRole(role)).toBe(true);
    const ir = build([
      { x0: 0, x1: 10, feature: role },
      { x0: 100, x1: 110, feature: 1 /* Perimeter */ }
    ]);
    expect(ir.header.capabilities.nonModelClassification).toBe('inferred');
    expect(ir.modelBounds.min.x).toBeCloseTo(100, 5);
    expect(ir.modelBounds.max.x).toBeCloseTo(110, 5);
  });

  it.each([0, 1, 2, 3, 4, 8, 9, 10])('role %i is not housekeeping', (role) => {
    expect(isHousekeepingRole(role)).toBe(false);
  });
});

describe('classify model-bounds axes (C19–C26, C28)', () => {
  const P = { x: 1, y: 2, z: 0.2 };
  const Q = { x: 11, y: 22, z: 0.8 };
  const expectBox = (ir: ToolpathIR): void => {
    const m = ir.modelBounds;
    expect(ir.header.capabilities.nonModelClassification).toBe('known');
    expect([m.min.x, m.min.y, m.min.z, m.max.x, m.max.y, m.max.z].map((v) => Math.round(v * 1000) / 1000)).toEqual([
      1, 2, 0.2, 11, 22, 0.8
    ]);
  };

  it('start at the minimum, end at the maximum', () => {
    expectBox(build([{ x0: P.x, y0: P.y, z0: P.z, x1: Q.x, y1: Q.y, z1: Q.z, object: 1 }]));
  });

  it('start at the maximum, end at the minimum', () => {
    expectBox(build([{ x0: Q.x, y0: Q.y, z0: Q.z, x1: P.x, y1: P.y, z1: P.z, object: 1 }]));
  });
});

describe('source-map edges (M03, M15)', () => {
  it('a string source is measured in UTF-8 bytes, not UTF-16 code units', () => {
    // 'é' is 2 bytes in UTF-8: line 1 = "; é\n" (5 bytes), line 2 = "G1 X1" (5 bytes) → 10 bytes.
    const li = buildSourceLineIndex('; é\nG1 X1');
    expect(li.byteLength).toBe(10);
    expect(Array.from(li.lineStarts)).toEqual([0, 5]);
    expect(byteRangeOfLine(li, 2)).toEqual([5, 10]);
  });

  it('segmentAtSourceLine of an out-of-range line is -1, never a throw', () => {
    const li = buildSourceLineIndex('G1 X1\nG1 X2\n');
    const idx = buildSourceIndex(Uint32Array.from([0, 6]), 2);
    expect(segmentAtSourceLine(idx, li, 0)).toBe(-1);
    expect(segmentAtSourceLine(idx, li, 3)).toBe(-1);
    expect(segmentAtSourceLine(idx, li, 2)).toBe(1);
  });
});
