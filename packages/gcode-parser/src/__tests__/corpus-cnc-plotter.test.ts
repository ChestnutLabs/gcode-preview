/**
 * #189 corpus: servo-pen plotter, Z-lift pen plotter and inch-units (G20) router fixtures.
 *
 * These pin what the parser does TODAY, in literal values, so a change in behaviour is a visible,
 * reviewed re-pin rather than a silent drift. Two of the pinned behaviours are known gaps:
 *
 * - Pen state is not modelled (DD-012 D3 `penState`, #579). `M280` is an `unsupported-command`, and a
 *   Z-lift pen has no tool-on code, so a pen-down stroke is `Travel` (kind 2) exactly like a pen-up move,
 *   and `bounds` (the drawn extent) is empty. Only `boundsWithTravel` holds the drawing.
 * - G20 is recorded, not converted. `header.units` is `'in'`, but the coordinates stay in inches. The
 *   arc count is the one geometric effect: inch arcs are flattened finer (parse.ts arc tolerance), so
 *   G20 → G21 turns 80 arc segments into 4. When G20 → mm conversion lands (#578), re-pin the inch block below.
 *
 * Kind values are literal bits (Travel = 2, ArcSegment = 32, Cut = 128), never the module's constants.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../index';

const cncDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'test-data', 'fixtures', 'cnc');
const parseFixture = (name: string): ToolpathIR =>
  parseGcodeToIR(readFileSync(join(cncDir, name), 'utf8'), { sourceId: name }).ir;

const f = (n: number): string => n.toFixed(4);
/** Segment i as `kind (x0,y0,z0)->(x1,y1,z1)` in absolute coordinates, 4 decimals. */
function seg(ir: ToolpathIR, i: number): string {
  const s = ir.segments;
  const o = ir.header.originOffset;
  return (
    `${s.kind[i]} (${f(o.x + s.x0[i])},${f(o.y + s.y0[i])},${f(o.z + s.z0[i])})` +
    `->(${f(o.x + s.x1[i])},${f(o.y + s.y1[i])},${f(o.z + s.z1[i])})`
  );
}
function kindHistogram(ir: ToolpathIR): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < ir.segments.count; i++) out[ir.segments.kind[i]] = (out[ir.segments.kind[i]] ?? 0) + 1;
  return out;
}
const box = (b: ToolpathIR['bounds']): string =>
  `(${f(b.min.x)},${f(b.min.y)},${f(b.min.z)})-(${f(b.max.x)},${f(b.max.y)},${f(b.max.z)})`;
const warningCodes = (ir: ToolpathIR): string[] => [...new Set(ir.header.warnings.map((w) => w.code))].sort();

describe('cnc-plotter-servo-pen (M280 pen, #189)', () => {
  const ir = parseFixture('plotter-servo-pen.gcode');

  it('is a mm file with every move Travel: pen-down strokes are not told apart from pen-up moves', () => {
    expect(ir.header.units).toBe('mm');
    expect(ir.header.unitsSource).toBe('known');
    expect(ir.segments.count).toBe(133);
    // 7 straight moves (Travel) + 126 arc segments (Travel | ArcSegment); no Cut, no Extrude.
    expect(kindHistogram(ir)).toEqual({ 2: 7, 34: 126 });
    expect(ir.header.capabilities.cutMoves).toBe('unavailable');
  });

  it('reports M280 as an unsupported command', () => {
    expect(warningCodes(ir)).toEqual(['layers-unavailable', 'unsupported-command']);
    const unsupported = ir.header.warnings.filter((w) => w.code === 'unsupported-command');
    expect(unsupported.some((w) => /m280/i.test(w.message))).toBe(true);
  });

  it('pins the first pen-down stroke and the pen-up moves around it, all kind 2', () => {
    expect(seg(ir, 0)).toBe('2 (0.0000,0.0000,0.0000)->(10.0000,10.0000,0.0000)'); // pen up: G0 X10 Y10
    expect(seg(ir, 1)).toBe('2 (10.0000,10.0000,0.0000)->(40.0000,10.0000,0.0000)'); // pen DOWN: G1 X40 Y10
    expect(seg(ir, 4)).toBe('2 (10.0000,30.0000,0.0000)->(10.0000,10.0000,0.0000)'); // pen down, closes the rectangle
    expect(seg(ir, 5)).toBe('2 (10.0000,10.0000,0.0000)->(50.0000,20.0000,0.0000)'); // pen up: G0 X50 Y20
    expect(seg(ir, 131)).toBe('34 (50.0086,19.5842,0.0000)->(50.0000,20.0000,0.0000)'); // circle closes at its start
    expect(seg(ir, 132)).toBe('2 (50.0000,20.0000,0.0000)->(0.0000,0.0000,0.0000)'); // pen up: G0 X0 Y0
  });

  it('has an empty drawn extent; only boundsWithTravel holds the drawing', () => {
    expect(ir.bounds.min.x).toBe(Infinity);
    expect(ir.bounds.max.x).toBe(-Infinity);
    expect(box(ir.boundsWithTravel)).toBe('(0.0000,0.0000,0.0000)-(70.0000,30.0000,0.0000)');
  });
});

describe('cnc-plotter-z-pen (Z-lift pen, #189)', () => {
  const ir = parseFixture('plotter-z-pen.gcode');

  it('is a mm file of 12 Travel moves with no warning beyond layers', () => {
    expect(ir.header.units).toBe('mm');
    expect(ir.segments.count).toBe(12);
    expect(kindHistogram(ir)).toEqual({ 2: 12 });
    expect(warningCodes(ir)).toEqual(['layers-unavailable']);
    expect(ir.header.capabilities.cutMoves).toBe('unavailable');
  });

  it('pins the pen-down plunge and the stroke drawn at Z0, both kind 2', () => {
    expect(seg(ir, 1)).toBe('2 (0.0000,0.0000,5.0000)->(10.0000,10.0000,5.0000)'); // pen up travel
    expect(seg(ir, 2)).toBe('2 (10.0000,10.0000,5.0000)->(10.0000,10.0000,0.0000)'); // G1 Z0: pen down
    expect(seg(ir, 3)).toBe('2 (10.0000,10.0000,0.0000)->(30.0000,10.0000,0.0000)'); // stroke at Z0
    expect(seg(ir, 6)).toBe('2 (10.0000,10.0000,0.0000)->(10.0000,10.0000,5.0000)'); // G1 Z5: pen up
    expect(seg(ir, 7)).toBe('2 (10.0000,10.0000,5.0000)->(40.0000,10.0000,5.0000)');
  });

  it('has an empty drawn extent; only boundsWithTravel holds the drawing', () => {
    expect(ir.bounds.min.x).toBe(Infinity);
    expect(box(ir.boundsWithTravel)).toBe('(0.0000,0.0000,0.0000)-(40.0000,25.0000,5.0000)');
  });
});

describe('cnc-router-inch-g20 (G20 inch units, #189)', () => {
  const ir = parseFixture('router-inch-g20.gcode');

  it('records inch units from the G20 word', () => {
    expect(ir.header.units).toBe('in');
    expect(ir.header.unitsSource).toBe('known');
  });

  it('flattens each inch quarter-arc into 40 segments (G21 would give 2)', () => {
    expect(ir.segments.count).toBe(89);
    // 4 Travel, 5 straight Cut, 80 arc Cut (Cut | ArcSegment).
    expect(kindHistogram(ir)).toEqual({ 2: 4, 128: 5, 160: 80 });
    expect(ir.header.capabilities.cutMoves).toBe('known');
  });

  it('keeps the coordinates in inches: they are not converted to mm', () => {
    expect(seg(ir, 2)).toBe('128 (0.5000,0.5000,0.2500)->(0.5000,0.5000,-0.0500)'); // plunge 0.05 in
    expect(seg(ir, 3)).toBe('128 (0.5000,0.5000,-0.0500)->(2.5000,0.5000,-0.0500)'); // not 12.7 → 63.5 mm
    expect(seg(ir, 4)).toBe('160 (2.5000,0.5000,-0.0500)->(2.5200,0.5004,-0.0500)'); // first G3 corner segment
    expect(seg(ir, 85)).toBe('128 (2.5000,2.5000,-0.0500)->(0.5000,2.5000,-0.0500)');
    expect(seg(ir, 88)).toBe('2 (0.5000,0.5000,0.2500)->(0.0000,0.0000,0.2500)');
    // boundsWithTravel, not bounds: #568 makes Cut count toward bounds, which would re-pin bounds here.
    expect(box(ir.boundsWithTravel)).toBe('(0.0000,0.0000,-0.0500)-(3.0000,2.5000,0.2500)');
  });

  it('reports only M30 as unsupported', () => {
    expect(warningCodes(ir)).toEqual(['layers-unavailable', 'unsupported-command']);
    const unsupported = ir.header.warnings.filter((w) => w.code === 'unsupported-command');
    expect(unsupported.map((w) => w.message)).toEqual(["unsupported command 'm30' preserved as metadata"]);
  });
});
