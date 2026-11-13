/**
 * #579: configured pen-plotter pen state (DD-012 D3 `penState`, amended 2026-11-13).
 *
 * `parseOptions.pen` is the only switch. Without it nothing changes (the default parse of the plotter
 * fixtures is pinned in corpus-cnc-plotter.test.ts). With it, a pen-down XY feed move is `Cut`; the move
 * that plunges or lifts the pen, and every rapid, stays `Travel`. Nothing is ever inferred from a number.
 *
 * Written before the parser change (WIP): these are expected RED until `pen` is implemented in parse.ts.
 * Kind values are literal bits (Travel = 2, Cut = 128, Cut | ArcSegment = 160), never the module's constants.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ParseOptionError, parseGcodeToIR, type ParseOptions } from '../index';

const cncDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'test-data', 'fixtures', 'cnc');
const read = (name: string): string => readFileSync(join(cncDir, name), 'utf8');
/** `pen` is not in the ParseOptions type until the parser change lands, so build the options untyped. */
const withPen = (pen: unknown): ParseOptions => ({ pen }) as unknown as ParseOptions;
const parse = (text: string, pen?: unknown): ToolpathIR =>
  parseGcodeToIR(text, pen === undefined ? {} : withPen(pen)).ir;

const f = (n: number): string => n.toFixed(4);
function kindHistogram(ir: ToolpathIR): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < ir.segments.count; i++) out[ir.segments.kind[i]] = (out[ir.segments.kind[i]] ?? 0) + 1;
  return out;
}
const kinds = (ir: ToolpathIR): number[] => Array.from(ir.segments.kind.subarray(0, ir.segments.count));
const box = (b: ToolpathIR['bounds']): string =>
  `(${f(b.min.x)},${f(b.min.y)},${f(b.min.z)})-(${f(b.max.x)},${f(b.max.y)},${f(b.max.z)})`;
const warningCodes = (ir: ToolpathIR): string[] => [...new Set(ir.header.warnings.map((w) => w.code))].sort();
const caps = (ir: ToolpathIR): Record<string, unknown> => ir.header.capabilities as unknown as Record<string, unknown>;

const SERVO = { servo: { downAngles: [20, 40] } };
const Z = { z: { downAtOrBelow: 0 } };

describe('pen.servo (M280): the S angle in downAngles is pen-down', () => {
  const text = read('plotter-servo-pen.gcode');

  it('turns the 4 rectangle strokes and the 126 circle arc segments into Cut; G0 stays Travel', () => {
    const ir = parse(text, SERVO);
    expect(ir.segments.count).toBe(133);
    // 3 rapids (Travel), 4 straight pen-down strokes (Cut), 126 pen-down arc segments (Cut | ArcSegment).
    expect(kindHistogram(ir)).toEqual({ 2: 3, 128: 4, 160: 126 });
    expect(ir.header.capabilities.cutMoves).toBe('known');
    expect(caps(ir).penState).toBe('known');
  });

  it('counts the drawing in bounds: rectangle (10,10)-(40,30) plus the circle out to x = 70', () => {
    const ir = parse(text, SERVO);
    expect(box(ir.bounds)).toBe('(10.0000,10.0000,0.0000)-(70.0000,30.0000,0.0000)');
  });

  it('no longer reports M280 as an unsupported command', () => {
    const ir = parse(text, SERVO);
    expect(warningCodes(ir)).toEqual(['layers-unavailable']);
  });

  it('treats an S outside downAngles as pen up, bounds inclusive', () => {
    const prog = (s: number): string => `M280 P0 S${s}\nG1 X10 Y0 F600\n`;
    expect(kinds(parse(prog(20), SERVO))).toEqual([128]); // lower bound is down
    expect(kinds(parse(prog(40), SERVO))).toEqual([128]); // upper bound is down
    expect(kinds(parse(prog(19), SERVO))).toEqual([2]);
    expect(kinds(parse(prog(41), SERVO))).toEqual([2]);
  });

  it('follows the latest M280: down, then up, then a feed move is Travel again', () => {
    const ir = parse('M280 P0 S30\nG1 X10 F600\nM280 P0 S90\nG1 X20 F600\n', SERVO);
    expect(kinds(ir)).toEqual([128, 2]);
  });

  it('with pin set, only that servo moves the pen; another pin is not the pen', () => {
    const pen = { servo: { pin: 1, downAngles: [20, 40] } };
    expect(kinds(parse('M280 P1 S30\nG1 X10 F600\n', pen))).toEqual([128]);
    expect(kinds(parse('M280 P0 S30\nG1 X10 F600\n', pen))).toEqual([2]);
  });

  it('without pin, any servo counts', () => {
    expect(kinds(parse('M280 P3 S30\nG1 X10 F600\n', SERVO))).toEqual([128]);
  });

  it('before any M280 the pen state is unknown: a feed move is Travel, and penState is unavailable', () => {
    const ir = parse('G1 X10 F600\nG1 X20\n', SERVO);
    expect(kinds(ir)).toEqual([2, 2]);
    expect(caps(ir).penState).toBe('unavailable');
  });

  it('a configured file with no matching M280 gets one deduped no-match hint', () => {
    const ir = parse('G1 X10 F600\nG1 X20\nG1 X30\n', SERVO);
    const hints = ir.header.warnings.filter((w) => w.code === 'pen-state-no-match');
    expect(hints).toHaveLength(1);
    expect(hints[0].severity).toBe('info');
  });

  it('a matching file gets no no-match hint', () => {
    expect(warningCodes(parse(text, SERVO))).not.toContain('pen-state-no-match');
  });
});

describe('pen.z: a feed move at or below downAtOrBelow is pen-down', () => {
  const text = read('plotter-z-pen.gcode');

  it('Cut for the 3 triangle sides and the 1 separate stroke; plunge, lift and rapids stay Travel', () => {
    const ir = parse(text, Z);
    expect(ir.segments.count).toBe(12);
    // Cut: G1 X30 Y10, G1 X30 Y25, G1 X10 Y10, G1 X40 Y25. The 2 plunges and 2 lifts are Travel.
    expect(kindHistogram(ir)).toEqual({ 2: 8, 128: 4 });
    expect(kinds(ir)).toEqual([2, 2, 2, 128, 128, 128, 2, 2, 2, 128, 2, 2]);
    expect(caps(ir).penState).toBe('known');
    expect(ir.header.capabilities.cutMoves).toBe('known');
  });

  it('counts the drawing in bounds', () => {
    expect(box(parse(text, Z).bounds)).toBe('(10.0000,10.0000,0.0000)-(40.0000,25.0000,0.0000)');
  });

  it('the threshold is inclusive and the next step above is pen up', () => {
    const prog = (z: number): string => `G0 Z${z}\nG1 X10 F600\n`;
    expect(kinds(parse(prog(0.5), { z: { downAtOrBelow: 0.5 } }))).toEqual([2, 128]);
    expect(kinds(parse(prog(0.6), { z: { downAtOrBelow: 0.5 } }))).toEqual([2, 2]);
  });

  it('a negative threshold works (Z below the work zero)', () => {
    expect(kinds(parse('G0 Z-1\nG1 X10 F600\n', { z: { downAtOrBelow: -0.5 } }))).toEqual([2, 128]);
  });

  it('a file whose Z never crosses the threshold gets penState unavailable and one no-match hint', () => {
    const ir = parse('G0 Z5\nG1 X10 F600\nG1 X20\n', Z);
    expect(kinds(ir)).toEqual([2, 2, 2]);
    expect(caps(ir).penState).toBe('unavailable');
    expect(ir.header.warnings.filter((w) => w.code === 'pen-state-no-match')).toHaveLength(1);
  });
});

describe('the pen option never changes files it does not apply to', () => {
  // A first-layer FDM file with Z-hop travel at a low Z: the Z rule must not read these as pen-down.
  const fdm = [
    'G21',
    'G90',
    'M82',
    'G1 Z5 F3000',
    'G1 X5 Y5',
    'G1 Z0.2 F1200',
    'G1 X10 Y10 E0.0',
    'G1 X20 Y10 E1.0 F1800', // extrusion (first E move)
    'G1 X20 Y20 E2.0',
    'G1 X30 Y30 F6000', // travel at Z0.2, no E: not pen-down
    'G1 Z0.6',
    'G1 X40 Y30',
    'G1 Z0.2',
    'G1 X50 Y30 E3.0',
    ''
  ].join('\n');

  it('FDM with Z-hop and the z option SET: segments and bounds are identical to the default parse', () => {
    // Option set to 0.3 so the layer-1 travel at Z0.2 is below it.
    const plain = parse(fdm);
    const set = parse(fdm, { z: { downAtOrBelow: 0.3 } });
    expect(kinds(set)).toEqual(kinds(plain));
    expect(box(set.bounds)).toBe(box(plain.bounds));
    expect(Array.from(set.segments.x1.subarray(0, set.segments.count))).toEqual(
      Array.from(plain.segments.x1.subarray(0, plain.segments.count))
    );
    expect(kindHistogram(set)[128]).toBeUndefined();
    expect(caps(set).penState).toBe('unavailable');
  });

  it('CNC with M3 and the z option SET: the spindle, not the Z threshold, decides Cut', () => {
    const cnc = 'G21\nG90\nG0 Z5\nG0 X0 Y0\nM3 S10000\nG1 Z-1 F200\nG1 X10 F600\nM5\nG1 X20 F600\nG0 Z5\n';
    const plain = parse(cnc);
    const set = parse(cnc, { z: { downAtOrBelow: 0 } });
    expect(kinds(plain)).toEqual([2, 2, 128, 128, 2, 2]);
    expect(kinds(set)).toEqual(kinds(plain));
    expect(caps(set).penState).toBe('unavailable');
  });

  it('the default parse of both plotter fixtures is unchanged: no Cut, no penState', () => {
    for (const name of ['plotter-servo-pen.gcode', 'plotter-z-pen.gcode']) {
      const ir = parse(read(name));
      expect(kindHistogram(ir)[128]).toBeUndefined();
      expect(caps(ir).penState).toBe('unavailable');
      expect(ir.header.capabilities.cutMoves).toBe('unavailable');
    }
  });

  it('a default parse of M280 still reports it as unsupported, with no pen hint', () => {
    const ir = parse('M280 P0 S30\nG1 X10 F600\n');
    expect(warningCodes(ir)).toEqual(['layers-unavailable', 'unsupported-command']);
  });

  it('a servo-configured M3/M5 plotter keeps the spindle behaviour', () => {
    const prog = 'M3 S1\nG1 X10 F600\nM5\nG1 X20 F600\n';
    expect(kinds(parse(prog, SERVO))).toEqual([128, 2]);
  });
});

describe('pen option validation: a bad option throws E_PARSE_OPTION before parsing', () => {
  const BAD: [string, unknown][] = [
    ['null', null],
    ['a string', 'servo'],
    ['an array', []],
    ['an empty object', {}],
    ['both servo and z', { servo: { downAngles: [20, 40] }, z: { downAtOrBelow: 0 } }],
    ['an unknown key', { laser: {} }],
    ['servo as a number', { servo: 5 }],
    ['servo without downAngles', { servo: {} }],
    ['downAngles with one entry', { servo: { downAngles: [20] } }],
    ['downAngles with three entries', { servo: { downAngles: [20, 30, 40] } }],
    ['downAngles min above max', { servo: { downAngles: [40, 20] } }],
    ['downAngles with NaN', { servo: { downAngles: [NaN, 40] } }],
    ['downAngles with Infinity', { servo: { downAngles: [20, Infinity] } }],
    ['downAngles with a string', { servo: { downAngles: ['20', 40] } }],
    ['pin negative', { servo: { pin: -1, downAngles: [20, 40] } }],
    ['pin fractional', { servo: { pin: 1.5, downAngles: [20, 40] } }],
    ['pin NaN', { servo: { pin: NaN, downAngles: [20, 40] } }],
    ['z as a number', { z: 0 }],
    ['z without downAtOrBelow', { z: {} }],
    ['downAtOrBelow NaN', { z: { downAtOrBelow: NaN } }],
    ['downAtOrBelow Infinity', { z: { downAtOrBelow: Infinity } }],
    ['downAtOrBelow a string', { z: { downAtOrBelow: '0' } }]
  ];

  for (const [label, pen] of BAD) {
    it(`${label} throws`, () => {
      let caught: unknown;
      try {
        parseGcodeToIR('G1 X1 Y1 E1\n', withPen(pen));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ParseOptionError);
      expect((caught as ParseOptionError).code).toBe('E_PARSE_OPTION');
      expect((caught as ParseOptionError).message).toContain('pen');
    });
  }

  it('pen: undefined is the default parse, not an error', () => {
    expect(() => parseGcodeToIR('G1 X1 Y1 E1\n', withPen(undefined))).not.toThrow();
  });

  it('valid shapes are accepted, including pin 0 and a single-angle range [30, 30]', () => {
    expect(() => parse('G1 X1\n', { servo: { pin: 0, downAngles: [30, 30] } })).not.toThrow();
    expect(() => parse('G1 X1\n', { z: { downAtOrBelow: -2.5 } })).not.toThrow();
  });
});
