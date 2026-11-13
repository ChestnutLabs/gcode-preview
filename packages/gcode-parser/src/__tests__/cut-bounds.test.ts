/**
 * #568 / DD-012 D7, end to end: a laser burn parsed from text gets its cut extent as `bounds`
 * (not empty), a printer with a laser head gets the union, and an FDM file is unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { ToolpathBounds } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../index';

/** Float32 storage: 0.2 round-trips as 0.20000000298…, so compare each coordinate to 5 decimals. */
function expectBox(b: ToolpathBounds, min: [number, number, number], max: [number, number, number]): void {
  expect([b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(5))).toEqual(min);
  expect([b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(5))).toEqual(max);
}

const EMPTY = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };

describe('Cut bounds through the parser (#568)', () => {
  it('a laser burn (M4 … M5) frames the burn, not the rapid home', () => {
    const { ir } = parseGcodeToIR('G0 X50 Y50\nM4 S255\nG1 X60 Y50 F1000\nG1 X60 Y60\nM5\nG0 X0 Y0\n');
    expect(ir.bounds).toEqual({ min: { x: 50, y: 50, z: 0 }, max: { x: 60, y: 60, z: 0 } });
    expect(ir.boundsWithTravel).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 60, y: 60, z: 0 } });
    expect(ir.modelBounds).toEqual(EMPTY);
    expect(ir.header.capabilities.nonModelClassification).toBe('unavailable');
  });

  it('a rapid with the laser on (G0 while M3) stays out of bounds', () => {
    const { ir } = parseGcodeToIR('M3 S100\nG0 X90 Y90\nG1 X91 Y90 F600\nM5\n');
    expect(ir.bounds).toEqual({ min: { x: 90, y: 90, z: 0 }, max: { x: 91, y: 90, z: 0 } });
  });

  it('an FDM print plus a laser pass gets the union of extrusion and cut', () => {
    const { ir } = parseGcodeToIR(
      'G90\nM82\nG1 Z0.2 F600\nG92 E0\nG1 X10 Y10 E1 F1200\nG1 X20 Y10 E2\nG1 X20 Y20 E3\n' +
        'G0 Z5\nM3 S200\nG1 X100 Y100 F800\nG1 X120 Y100\nM5\nG0 X0 Y0\n'
    );
    expectBox(ir.bounds, [0, 0, 0.2], [120, 100, 5]);
  });

  it('an FDM-only file is unchanged: bounds over extrusion only', () => {
    const { ir } = parseGcodeToIR('G90\nM82\nG1 Z0.2\nG92 E0\nG1 X10 Y10 E1 F1200\nG1 X20 Y10 E2\nG0 X0 Y0\n');
    expectBox(ir.bounds, [0, 0, 0.2], [20, 10, 0.2]);
  });
});
