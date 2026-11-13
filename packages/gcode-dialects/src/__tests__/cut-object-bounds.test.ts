/**
 * #568 end to end through a dialect: the sink recomputes `objectBounds` after it labels objects, so a labelled
 * laser cut must count there too (Extrude | Cut), matching toolpath-core's parse-time pass. `modelBounds` and
 * `nonModelClassification` stay extrusion-only. Expected values are literals.
 */
import { describe, expect, it } from 'vitest';
import type { ToolpathBounds } from '@chestnutlabs/toolpath-core';
import { klipper } from '../firmware';
import { annotate, must } from './sweep-4-helpers';

/** Float32 storage: 0.2 round-trips as 0.20000000298…, so compare each coordinate to 5 decimals. */
function box(b: ToolpathBounds): number[] {
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(5));
}

const EMPTY = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

describe('a labelled cut counts toward objectBounds through the dialect sink (#568)', () => {
  it('cut-only: one labelled laser burn gives objectBounds = the burn; still unavailable', () => {
    const r = must(
      annotate(
        [klipper()],
        [
          'EXCLUDE_OBJECT_DEFINE NAME=burn',
          'G0 X50 Y50',
          'EXCLUDE_OBJECT_START NAME=burn',
          'M4 S255',
          'G1 X60 Y50 F1000',
          'G1 X60 Y60',
          'M5',
          'EXCLUDE_OBJECT_END NAME=burn',
          'G0 X0 Y0'
        ]
      )
    );
    expect(Array.from(r.ir.segments.kind)).toEqual([2, 128, 128, 2]);
    expect(Array.from(r.ir.segments.object)).toEqual([0, 1, 1, 0]);
    expect(box(r.ir.objectBounds)).toEqual([50, 50, 0, 60, 60, 0]);
    expect(box(r.ir.modelBounds)).toEqual(EMPTY);
    expect(r.ir.header.capabilities.nonModelClassification).toBe('unavailable');
  });

  it('a printed part plus a labelled burn: objectBounds is the union, modelBounds stays the print', () => {
    const r = must(
      annotate(
        [klipper()],
        [
          'EXCLUDE_OBJECT_DEFINE NAME=part_a',
          'EXCLUDE_OBJECT_DEFINE NAME=burn',
          'G90',
          'M82',
          'G1 Z0.2 F600',
          'G92 E0',
          'EXCLUDE_OBJECT_START NAME=part_a',
          'G1 X10 Y10 E1 F1200',
          'G1 X20 Y10 E2',
          'G1 X20 Y20 E3',
          'EXCLUDE_OBJECT_END NAME=part_a',
          'G0 Z5',
          'EXCLUDE_OBJECT_START NAME=burn',
          'M3 S200',
          'G1 X100 Y100 F800',
          'G1 X120 Y100',
          'M5',
          'EXCLUDE_OBJECT_END NAME=burn',
          'G0 X0 Y0'
        ]
      )
    );
    expect(box(r.ir.objectBounds)).toEqual([0, 0, 0.2, 120, 100, 5]);
    expect(box(r.ir.modelBounds)).toEqual([0, 0, 0.2, 20, 20, 0.2]);
  });
});
