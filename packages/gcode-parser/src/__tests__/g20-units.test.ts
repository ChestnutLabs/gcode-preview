/**
 * #578: G20 inch files are converted to millimetres in the parser. IR coordinates are always mm;
 * `header.units` records the file's declaration ('in'), and `unitsSource` is unchanged.
 *
 * Under G20 every length word is scaled by 25.4 once, right after lexing: X Y Z, I J K, R (arc and canned
 * retract), Q (G83 peck), F (in/min → mm/min) and E. Stored state (position, G92 / G10 offsets, canned
 * planes) is therefore mm, so a mid-file G21 needs no rescale. Expected values are literal millimetres.
 */
import { describe, expect, it } from 'vitest';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR, parseGcodeStreamToIR } from '../index';

const parse = (src: string) => parseGcodeToIR(src + '\n', {});
const ax = (ir: ToolpathIR, i: number, k: 'x1' | 'y1' | 'z1' | 'x0' | 'y0' | 'z0'): number => {
  const o = ir.header.originOffset;
  const base = k[0] === 'x' ? o.x : k[0] === 'y' ? o.y : o.z;
  return base + ir.segments[k][i];
};
const end = (ir: ToolpathIR, i: number): string =>
  `(${ax(ir, i, 'x1').toFixed(4)},${ax(ir, i, 'y1').toFixed(4)},${ax(ir, i, 'z1').toFixed(4)})`;
const ends = (ir: ToolpathIR): string[] => Array.from({ length: ir.segments.count }, (_, i) => end(ir, i));
const codes = (ir: ToolpathIR, code: string) => ir.header.warnings.filter((w) => w.code === code);

describe('G20 → mm: axis words, units header, the units-converted note', () => {
  it('scales X/Y/Z and keeps the declaration in the header', () => {
    const { ir } = parse('G20\nG0 X1 Y2 Z0.5');
    expect(ends(ir)).toEqual(['(25.4000,50.8000,12.7000)']);
    expect(ir.header.units).toBe('in');
    expect(ir.header.unitsSource).toBe('known');
  });

  it('a G21 file and a file with no units word are unchanged and carry no note', () => {
    for (const src of ['G21\nG0 X1 Y2', 'G0 X1 Y2']) {
      const { ir } = parse(src);
      expect(ends(ir)).toEqual(['(1.0000,2.0000,0.0000)']);
      expect(codes(ir, 'units-converted')).toEqual([]);
    }
  });

  it('notes the conversion once per file, as info, even with several G20s', () => {
    const { ir, stats } = parse('G20\nG0 X1\nG21\nG0 X1\nG20\nG0 X2');
    const notes = codes(ir, 'units-converted');
    expect(notes).toHaveLength(1);
    expect(notes[0].severity).toBe('info');
    expect(notes[0].count).toBe(1);
    expect(notes[0].srcByte).toBe(0);
    expect(stats.warningsByCode['units-converted']).toBe(1);
  });

  it('a mid-file G21 → G20 → G21 switch converts only the moves under G20', () => {
    const { ir } = parse('G21\nG0 X10\nG20\nG0 X1\nG1 X2 Y1\nG21\nG0 X10\nG1 Y5');
    expect(ends(ir)).toEqual([
      '(10.0000,0.0000,0.0000)',
      '(25.4000,0.0000,0.0000)',
      '(50.8000,25.4000,0.0000)',
      '(10.0000,25.4000,0.0000)', // G21: X10 mm; Y stays 25.4 mm, the stored position is not rescaled
      '(10.0000,5.0000,0.0000)'
    ]);
  });

  it('G91 increments under G20 are inches', () => {
    const { ir } = parse('G21\nG0 X10\nG20 G91\nG0 X1\nG0 X1');
    expect(ends(ir)).toEqual(['(10.0000,0.0000,0.0000)', '(35.4000,0.0000,0.0000)', '(60.8000,0.0000,0.0000)']);
  });
});

describe('G20 on the same line as motion: units apply to the whole line (RS274NGC order)', () => {
  it('G20 after the move word still converts that move', () => {
    const { ir } = parse('G0 X1 G20');
    expect(ends(ir)).toEqual(['(25.4000,0.0000,0.0000)']);
    expect(codes(ir, 'units-converted')).toHaveLength(1);
  });

  it('G21 on a move line ends G20 for that move', () => {
    const { ir } = parse('G20\nG0 X1\nG0 X10 G21');
    expect(ends(ir)).toEqual(['(25.4000,0.0000,0.0000)', '(10.0000,0.0000,0.0000)']);
  });

  it('a bare modal motion line under G20 is converted', () => {
    const { ir } = parse('G20\nG1 X1\nX2 Y1');
    expect(ends(ir)).toEqual(['(25.4000,0.0000,0.0000)', '(50.8000,25.4000,0.0000)']);
  });
});

describe('G20 arcs (I/J/K, R): converted, flattened like the same arc in mm', () => {
  it('an I/J quarter arc lands on the mm target with the mm segment count', () => {
    const inch = parse('G20\nG0 X1 Y0\nG3 X0 Y1 I-1 J0').ir;
    const mm = parse('G21\nG0 X25.4 Y0\nG3 X0 Y25.4 I-25.4 J0').ir;
    // r = 25.4 mm, a quarter turn = 39.9 mm of arc → ceil(79.8) = 80 segments of ~0.5 mm, plus the G0.
    expect(inch.segments.count).toBe(81);
    expect(end(inch, 80)).toBe('(0.0000,25.4000,0.0000)');
    expect(end(inch, 40)).toBe(end(mm, 40));
    expect(ends(inch)).toEqual(ends(mm));
    expect(codes(inch, 'arc-end-off-circle')).toEqual([]);
  });

  it('K is scaled in the XZ plane', () => {
    // This G2 sweeps 270° in the XZ plane: 3 x 40 = 120 + 120 segments of ~0.5 mm, plus the G0.
    const inch = parse('G20 G18\nG0 X1 Z0\nG2 X0 Z1 I-1 K0').ir;
    expect(inch.segments.count).toBe(241);
    expect(end(inch, 240)).toBe('(0.0000,0.0000,25.4000)');
    expect(ends(inch)).toEqual(ends(parse('G21 G18\nG0 X25.4 Z0\nG2 X0 Z25.4 I-25.4 K0').ir));
  });

  it('J and K are scaled in the YZ plane', () => {
    const inch = parse('G20 G19\nG0 Y1 Z0\nG3 Y0 Z1 J-1 K0').ir;
    expect(end(inch, inch.segments.count - 1)).toBe('(0.0000,0.0000,25.4000)');
    expect(ends(inch)).toEqual(ends(parse('G21 G19\nG0 Y25.4 Z0\nG3 Y0 Z25.4 J-25.4 K0').ir));
  });

  it('an R arc is scaled (radius 1 in = 25.4 mm), with no radius-too-small note', () => {
    const inch = parse('G20\nG0 X0 Y0\nG2 X2 Y0 R1').ir;
    expect(end(inch, inch.segments.count - 1)).toBe('(50.8000,0.0000,0.0000)');
    expect(codes(inch, 'arc-radius-too-small')).toEqual([]);
    expect(ends(inch)).toEqual(ends(parse('G21\nG0 X0 Y0\nG2 X50.8 Y0 R25.4').ir));
  });
});

describe('G20 offsets and stored positions', () => {
  it('G92 after G20 shifts the datum by the converted amount', () => {
    // At X1 in (25.4 mm), G92 X0 declares that point 0, so X1 next reads 1 in past it: 50.8 mm.
    const { ir } = parse('G20\nG0 X1\nG92 X0 Y0\nG0 X1 Y0.5');
    expect(ends(ir)).toEqual(['(25.4000,0.0000,0.0000)', '(50.8000,12.7000,0.0000)']);
  });

  it('a G92 offset set under G20 stays in mm after G21', () => {
    const { ir } = parse('G20\nG0 X1\nG92 X0\nG21\nG0 X10');
    expect(end(ir, 1)).toBe('(35.4000,0.0000,0.0000)'); // 25.4 mm datum + 10 mm
  });

  it('G10 L2 offsets are converted', () => {
    const { ir } = parse('G20\nG10 L2 P1 X1 Y1 Z0\nG54\nG0 X1 Y0');
    expect(ends(ir)).toEqual(['(50.8000,25.4000,0.0000)']);
  });

  it('G10 L20 offsets are converted', () => {
    // At X25.4 mm, L20 X0 makes that point read 0 in G54; X1 in then lands at 50.8 mm.
    const { ir } = parse('G20\nG0 X1\nG10 L20 P1 X0\nG54\nG0 X1');
    expect(ends(ir)).toEqual(['(25.4000,0.0000,0.0000)', '(50.8000,0.0000,0.0000)']);
  });
});

describe('G20 canned cycles: R, Z and Q are converted', () => {
  it('G81 drills to the converted Z and retracts to the converted R', () => {
    const { ir } = parse('G20 G90 G98\nG0 Z1\nG81 X1 Y1 Z-0.1 R0.1');
    expect(ends(ir)).toEqual([
      '(0.0000,0.0000,25.4000)',
      '(25.4000,25.4000,25.4000)', // rapid to the hole at the initial plane
      '(25.4000,25.4000,2.5400)', // rapid down to R 0.1 in
      '(25.4000,25.4000,-2.5400)', // feed to Z -0.1 in
      '(25.4000,25.4000,25.4000)' // G98: back to the initial Z
    ]);
  });

  it('G83 pecks by the converted Q', () => {
    const inch = parse('G20 G90 G99\nG0 Z0.2\nG83 X0 Y0 Z-0.3 R0.1 Q0.1').ir;
    const mm = parse('G21 G90 G99\nG0 Z5.08\nG83 X0 Y0 Z-7.62 R2.54 Q2.54').ir;
    expect(inch.segments.count).toBe(mm.segments.count);
    expect(ends(inch)).toEqual(ends(mm));
    // the deepest point is Z -0.3 in, and the last move retracts to R (G99)
    expect(Math.min(...Array.from({ length: inch.segments.count }, (_, i) => ax(inch, i, 'z1')))).toBeCloseTo(-7.62, 4);
    expect(end(inch, inch.segments.count - 1)).toBe('(0.0000,0.0000,2.5400)');
  });

  it('a modal repeat hole under G20 is converted', () => {
    const { ir } = parse('G20 G90 G99\nG0 Z0.5\nG81 X0 Y0 Z-0.1 R0.1\nX2');
    expect(end(ir, ir.segments.count - 1)).toBe('(50.8000,0.0000,2.5400)');
  });
});

describe('G20 feedrate and E', () => {
  it('F is converted from in/min to mm/min', () => {
    const { ir } = parse('G20\nG1 X1 F10\nG1 X2 F0.5');
    expect(Array.from(ir.segments.feedrate!)).toEqual([254, 12.699999809265137]);
  });

  it('a bare F line under G20 is converted', () => {
    const { ir } = parse('G20\nF20\nG1 X1');
    expect(Array.from(ir.segments.feedrate!)).toEqual([508]);
  });

  it('E is converted, as Marlin does under G20', () => {
    const { ir, stats } = parse('G20\nM83\nG1 X1 E0.1');
    expect(stats.extrusionDistance).toBeCloseTo(2.54, 6);
    expect(ir.segments.e![0]).toBeCloseTo(2.54, 5);
  });

  it('G92 E under G20 rebases E in mm', () => {
    const { stats } = parse('G20\nM82\nG92 E1\nG1 X1 E1.5');
    expect(stats.extrusionDistance).toBeCloseTo(12.7, 5); // 0.5 in of filament
  });

  it('P, L, S and T are not lengths and are not scaled', () => {
    // G83 has no dwell, so check S with toolPower and the G2 P (turns) disclosure value.
    const { ir } = parseGcodeToIR('G20\nM3 S1000\nG1 X1 F10\nG2 X1 Y0 I-0.5 J0 P2\n', { modalChannels: ['toolPower'] });
    expect(ir.segments.modal!.toolPower[0]).toBe(1000);
    expect(codes(ir, 'arc-turns-ignored')[0].message).toContain('P2 ');
  });
});

describe('G20 with RS274NGC parameters: scaled where the value is used, never twice', () => {
  it('a #param used as an axis word under G20 is inches', () => {
    const { ir } = parse('#1=1\nG20\nG0 X#1 Y[#1*2]');
    expect(ends(ir)).toEqual(['(25.4000,50.8000,0.0000)']);
  });

  it('#5420–#5422 read the position in program units, so X#5420 does not double-scale', () => {
    const { ir } = parse('G20\nG0 X1 Y2 Z0.5\nG0 X[#5420+1] Y#5421 Z#5422');
    expect(ends(ir)).toEqual(['(25.4000,50.8000,12.7000)', '(50.8000,50.8000,12.7000)']);
  });

  it('#5420 reads mm under G21', () => {
    const { ir } = parse('G21\nG0 X10\nG0 X[#5420+1]');
    expect(end(ir, 1)).toBe('(11.0000,0.0000,0.0000)');
  });

  it('a stored parameter is not converted, so O-word comparisons stay as written', () => {
    const { ir } = parse('#1=2\nG20\no100 if [#1 EQ 2]\nG0 X#1\no100 endif');
    expect(ends(ir)).toEqual(['(50.8000,0.0000,0.0000)']);
  });
});

describe('G20 and the float32 range', () => {
  it('a word that fits float32 in inches but not in mm is dropped and disclosed, never Infinity', () => {
    // Written out in full: the lexer splits `3e38` at the letter E.
    const { ir } = parse(`G20\nG0 X1\nG0 X3${'0'.repeat(38)} Y1`);
    const notes = codes(ir, 'number-out-of-range');
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toContain("'X'");
    // X held at 1 in, Y applied: the move is drawn finite.
    expect(ends(ir)).toEqual(['(25.4000,0.0000,0.0000)', '(25.4000,25.4000,0.0000)']);
  });

  it('the same value under G21 fits and is not disclosed', () => {
    const { ir } = parse(`G21\nG0 X3${'0'.repeat(38)}`);
    expect(codes(ir, 'number-out-of-range')).toEqual([]);
  });
});

describe('G20 through the streaming driver', () => {
  it('agrees with the in-memory parse', async () => {
    const src = 'G20\nG0 X1 Y1\nG3 X0 Y2 I-1 J0 F20\nG92 X0\nG1 X1\n';
    const mem = parseGcodeToIR(src, {}).ir;
    const stream = (await parseGcodeStreamToIR(new Blob([src]), {}, { yieldIntervalMs: 10 })).ir;
    expect(ends(stream)).toEqual(ends(mem));
    expect(Array.from(stream.segments.feedrate!)).toEqual(Array.from(mem.segments.feedrate!));
    expect(codes(stream, 'units-converted')).toHaveLength(1);
  });
});

/**
 * The inch twin: a seeded random mm program and the same program written in inches (every length word
 * ÷ 25.4, a G20 header) must parse to the same IR. Values are multiples of 0.254 mm (0.01 in), so both
 * twins are written exactly. Covers lines, arcs in three planes, G91, G92, G10 L2/L20, G81/G83 with
 * modal repeats, feedrates and E.
 */
describe('G21 ↔ G20 twin programs parse to the same IR (seeded)', () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** A length of k hundredths of an inch, written both ways. */
  const len = (k: number): [string, string] => [(k * 0.254).toFixed(3), (k / 100).toFixed(2)];

  function twin(seed: number): [string, string] {
    const rnd = mulberry32(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const mm: string[] = ['G21 G90 G17 M83'];
    const inch: string[] = ['G20 G90 G17 M83'];
    const both = (parts: (string | [string, string])[]) => {
      mm.push(parts.map((p) => (typeof p === 'string' ? p : p[0])).join(''));
      inch.push(parts.map((p) => (typeof p === 'string' ? p : p[1])).join(''));
    };
    const word = (letter: string, k: number): (string | [string, string])[] => [` ${letter}`, len(k)];
    for (let n = 0; n < 60; n++) {
      const op = int(0, 9);
      if (op <= 2)
        both([
          'G1',
          ...word('X', int(-300, 300)),
          ...word('Y', int(-300, 300)),
          ...word('Z', int(0, 100)),
          ...word('F', int(10, 400)),
          ...word('E', int(1, 20))
        ]);
      else if (op === 3) both(['G0', ...word('X', int(-300, 300)), ...word('Y', int(-300, 300))]);
      else if (op === 4) {
        const plane = ['G17', 'G18', 'G19'][int(0, 2)];
        const [a, b] = plane === 'G17' ? ['I', 'J'] : plane === 'G18' ? ['I', 'K'] : ['J', 'K'];
        const [ta, tb] = plane === 'G17' ? ['X', 'Y'] : plane === 'G18' ? ['X', 'Z'] : ['Y', 'Z'];
        both([plane]);
        both([
          int(0, 1) ? 'G2' : 'G3',
          ...word(ta, int(-200, 200)),
          ...word(tb, int(-200, 200)),
          ...word(a, int(-150, 150)),
          ...word(b, int(-150, 150))
        ]);
        both(['G17']);
      } else if (op === 5)
        both([
          int(0, 1) ? 'G2' : 'G3',
          ...word('X', int(-200, 200)),
          ...word('Y', int(-200, 200)),
          ...word('R', int(-250, 250))
        ]);
      else if (op === 6) {
        both(['G91']);
        both(['G1', ...word('X', int(-50, 50)), ...word('Y', int(-50, 50))]);
        both(['G90']);
      } else if (op === 7) both(['G92', ...word('X', int(-100, 100)), ...word('Y', int(-100, 100))]);
      else if (op === 8)
        both([int(0, 1) ? 'G10 L2 P1' : 'G10 L20 P1', ...word('X', int(-100, 100)), ...word('Z', int(-20, 20))]);
      else {
        const peck = int(0, 1);
        both([
          peck ? 'G83' : 'G81',
          ...word('X', int(-200, 200)),
          ...word('Y', int(-200, 200)),
          ...word('Z', int(-80, -1)),
          ...word('R', int(1, 40)),
          ...(peck ? word('Q', int(5, 30)) : [])
        ]);
        both(['', ...word('X', int(-200, 200))]);
        both(['G80']);
      }
    }
    return [mm.join('\n') + '\n', inch.join('\n') + '\n'];
  }

  /** Positions are Float32 deltas, so compare to 1 µm rather than by rounded strings. */
  const near = (got: number, want: number, what: string) => {
    if (Number.isNaN(want))
      expect(got, what).toBeNaN(); // a rapid before any F has no feedrate
    else expect(Math.abs(got - want), `${what}: ${got} vs ${want}`).toBeLessThan(1e-3);
  };
  for (const seed of [1, 7, 42, 578, 2026]) {
    it(`seed ${seed}`, () => {
      const [mmSrc, inchSrc] = twin(seed);
      const mm = parseGcodeToIR(mmSrc, {});
      const inch = parseGcodeToIR(inchSrc, {});
      expect(inch.ir.header.units).toBe('in');
      expect(mm.ir.header.units).toBe('mm');
      const a = mm.ir.segments;
      const b = inch.ir.segments;
      expect(a.count).toBeGreaterThan(100);
      expect(b.count).toBe(a.count);
      for (let i = 0; i < a.count; i++) {
        for (const k of ['x0', 'y0', 'z0', 'x1', 'y1', 'z1'] as const) {
          near(ax(inch.ir, i, k), ax(mm.ir, i, k), `${k}[${i}]`);
        }
        expect(b.kind[i]).toBe(a.kind[i]);
        near(b.feedrate![i], a.feedrate![i], `feedrate[${i}]`);
        near(b.e![i], a.e![i], `e[${i}]`);
      }
      near(inch.stats.extrusionDistance, mm.stats.extrusionDistance, 'extrusionDistance');
    });
  }
});
