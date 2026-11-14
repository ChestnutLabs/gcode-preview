/**
 * #568 / DD-012 D7: `Cut` (a CNC/laser/plotter tool-engaged move) counts as productive for `bounds` and
 * `objectBounds`, like `Extrude`. The non-model classifier stays Extrude-only, so a Cut-only file keeps
 * `modelBounds` empty and `nonModelClassification: 'unavailable'`. Expected values are literals.
 */
import { describe, expect, it } from 'vitest';
import {
  ToolpathIRBuilder,
  classifyModelBounds,
  type SegmentInput,
  type ToolpathBounds,
  type ToolpathIR
} from '../index';

const EXTRUDE = 1;
const TRAVEL = 2;
const RETRACT = 4;
const UNRETRACT = 8;
const ARC = 32;
const CUT = 128;

type Seg = Partial<SegmentInput> & { x0: number; y0: number; x1: number; y1: number; kind: number };

function build(segs: Seg[]): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  segs.forEach((s, i) => b.addSegment({ z0: 0, z1: 0, e: 0, layer: 0, srcByte: i * 10, ...s }));
  return b.finalize();
}

/** Float32 storage: 0.2 round-trips as 0.20000000298…, so compare each coordinate to 5 decimals. */
function expectBox(b: ToolpathBounds, min: [number, number, number], max: [number, number, number]): void {
  expect([b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(5))).toEqual(min);
  expect([b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(5))).toEqual(max);
}

const EMPTY = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };

// The #568 laser burn: G0 X50 Y50 / M4 / G1 X60 Y50 / G1 X60 Y60 / M5 / G0 X0 Y0.
const LASER_BURN: Seg[] = [
  { x0: 0, y0: 0, x1: 50, y1: 50, kind: TRAVEL },
  { x0: 50, y0: 50, x1: 60, y1: 50, kind: CUT },
  { x0: 60, y0: 50, x1: 60, y1: 60, kind: CUT },
  { x0: 60, y0: 60, x1: 0, y1: 0, kind: TRAVEL }
];

describe('Cut counts toward bounds (#568)', () => {
  it('a Cut-only file gets the cut extent as bounds, not empty', () => {
    const ir = build(LASER_BURN);
    expect(ir.bounds).toEqual({ min: { x: 50, y: 50, z: 0 }, max: { x: 60, y: 60, z: 0 } });
    expect(ir.boundsWithTravel).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 60, y: 60, z: 0 } });
  });

  it('a Cut-only file still classifies as unavailable with empty modelBounds', () => {
    const ir = build(LASER_BURN);
    expect(ir.modelBounds).toEqual(EMPTY);
    expect(ir.header.capabilities.nonModelClassification).toBe('unavailable');
    const direct = classifyModelBounds(ir.segments, ir.header.originOffset);
    expect(direct.classification).toBe('unavailable');
    expect(direct.modelBounds).toEqual(EMPTY);
  });

  it('a mixed Extrude + Cut file gets the union of both', () => {
    const ir = build([
      { x0: 10, y0: 10, z0: 0.2, z1: 0.2, x1: 20, y1: 10, e: 1, kind: EXTRUDE },
      { x0: 20, y0: 10, z0: 0.2, z1: 0.2, x1: 20, y1: 20, e: 1, kind: EXTRUDE },
      { x0: 20, y0: 20, z0: 0.2, z1: 5, x1: 20, y1: 20, kind: TRAVEL },
      { x0: 20, y0: 20, z0: 5, z1: 5, x1: 100, y1: 100, kind: CUT },
      { x0: 100, y0: 100, z0: 5, z1: 5, x1: 120, y1: 100, kind: CUT }
    ]);
    expectBox(ir.bounds, [10, 10, 0.2], [120, 100, 5]);
  });

  it('a Cut arc facet (Cut | ArcSegment) counts too', () => {
    const ir = build([{ x0: 3, y0: 4, x1: 7, y1: 9, kind: CUT | ARC }]);
    expect(ir.bounds).toEqual({ min: { x: 3, y: 4, z: 0 }, max: { x: 7, y: 9, z: 0 } });
  });

  it('travel, retract and unretract stay excluded beside a cut', () => {
    const ir = build([
      { x0: -50, y0: -50, x1: -40, y1: -40, kind: TRAVEL },
      { x0: -30, y0: -30, x1: -30, y1: -30, kind: RETRACT },
      { x0: 200, y0: 200, x1: 200, y1: 200, kind: UNRETRACT },
      { x0: 1, y0: 2, x1: 3, y1: 4, kind: CUT }
    ]);
    expect(ir.bounds).toEqual({ min: { x: 1, y: 2, z: 0 }, max: { x: 3, y: 4, z: 0 } });
  });

  it('a file with only travel / retract keeps empty bounds', () => {
    const ir = build([
      { x0: 0, y0: 0, x1: 10, y1: 10, kind: TRAVEL },
      { x0: 10, y0: 10, x1: 10, y1: 10, kind: RETRACT }
    ]);
    expect(ir.bounds).toEqual(EMPTY);
  });

  it('a labelled Cut counts toward objectBounds; an unlabelled one does not', () => {
    const ir = build([
      { x0: 0, y0: 0, x1: 5, y1: 5, kind: CUT, object: 0 },
      { x0: 30, y0: 40, x1: 35, y1: 45, kind: CUT, object: 1 }
    ]);
    expect(ir.objectBounds).toEqual({ min: { x: 30, y: 40, z: 0 }, max: { x: 35, y: 45, z: 0 } });
    expect(ir.bounds).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 35, y: 45, z: 0 } });
    // The classifier stays Extrude-only: a labelled cut is not object membership.
    expect(ir.modelBounds).toEqual(EMPTY);
    expect(ir.header.capabilities.nonModelClassification).toBe('unavailable');
  });

  it('a labelled cut beside a labelled print stays out of modelBounds', () => {
    const ir = build([
      { x0: 10, y0: 10, x1: 20, y1: 20, e: 1, kind: EXTRUDE, object: 1 },
      { x0: 150, y0: 150, x1: 160, y1: 170, kind: CUT, object: 1 }
    ]);
    expect(ir.header.capabilities.nonModelClassification).toBe('known');
    expect(ir.modelBounds).toEqual({ min: { x: 10, y: 10, z: 0 }, max: { x: 20, y: 20, z: 0 } });
    expect(ir.objectBounds).toEqual({ min: { x: 10, y: 10, z: 0 }, max: { x: 160, y: 170, z: 0 } });
  });
});
