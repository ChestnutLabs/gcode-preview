/**
 * Parse P3 bundle: (1) under G91 the canned-cycle R and Z words are sticky NUMBERS re-applied per block;
 * (2) an unclosed or nested `(` comment is disclosed once (`unbalanced-paren-comment`); (3) `onComment`
 * splits at the first `;` OUTSIDE parentheses, matching the lexer.
 */
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '../index';
import { scanParenComments } from '../rs274';

function z1Of(src: string): number[] {
  const { ir } = parseGcodeToIR(src);
  return Array.from(ir.segments.z1).slice(0, ir.segments.count);
}

describe('G91 canned cycles keep R and Z as sticky increments', () => {
  it('LinuxCNC G81 incremental example, first hole: clear 4.8, bottom 4.2, retract to 4.8 (G98, R above start Z)', () => {
    // LinuxCNC g-code.html, G81 with `G91 G81 X4 Y5 Z-0.6 R1.8` from (1,2,3): "A rapid move parallel to the
    // Z-axis to (X5, Y7, Z4.8)" ... "feed parallel to the Z-axis to (X5, Y7, Z4.2)" ... retract "to the original
    // Z position (if that is above the R position and the retract mode is G98, OLD_Z), or otherwise to the R
    // position", i.e. 4.8 here. (The L repeat count is not modelled; the preliminary Z-up is, see
    // canned-preliminary-move.test.ts.) Segments: Z-up, XY rapid, (already at R), plunge, retract.
    const z = z1Of('G90\nG0 X1 Y2 Z3\nG91 G98\nG81 X4 Y5 Z-0.6 R1.8\n');
    const tail = z.slice(-5);
    const expected = [4.8, 4.8, 4.8, 4.2, 4.8];
    expect(tail).toHaveLength(5);
    tail.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
  });

  it('LinuxCNC G81 incremental example, next block: R is re-applied from the new current Z (4.8 + 1.8 = 6.6, depth 6.0)', () => {
    const z = z1Of('G90\nG0 X1 Y2 Z3\nG91 G98\nG81 X4 Y5 Z-0.6 R1.8\nG81 X4 Y5\n');
    const tail = z.slice(-5);
    const expected = [6.6, 6.6, 6.6, 6.0, 6.6];
    expect(tail).toHaveLength(5);
    tail.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
  });

  it('G98 retracts to the start Z when that is above R, and to R when R is above it (G90)', () => {
    // start 5, R 2: retract to 5.  start 1, R 3: retract to R (3), not back down to 1.
    expect(z1Of('G90\nG0 Z5\nG98\nG81 X1 Y0 Z-1 R2\n').slice(-4)).toEqual([5, 2, -1, 5]);
    expect(z1Of('G90\nG0 Z1\nG98\nG81 X1 Y0 Z-1 R3\n').slice(-5)).toEqual([3, 3, 3, -1, 3]);
  });

  it('G90 bare X/Y repeat keeps the stored absolute planes (R 2, Z -1)', () => {
    const z = z1Of('G90\nG0 Z5\nG99\nG81 X1 Y0 Z-1 R2\nX1\n');
    expect(z.slice(-4)).toEqual([2, 2, -1, 2]);
  });

  it('G91 with no Z ever given reads it as 0: the depth is the R plane itself, and the word is reported', () => {
    const src = 'G90\nG0 Z5\nG91 G98\nG81 X1 Y0 R2\nX1\n';
    expect(z1Of(src).slice(-10)).toEqual([7, 7, 7, 7, 7, 9, 9, 9, 9, 9]);
    const w = parseGcodeToIR(src).ir.header.warnings.filter((x) => x.code === 'canned-cycle-missing-word');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('no Z word');
  });

  it('G91 with no R ever given reads it as 0: the R plane is the current Z, depth R + Z, and the word is reported', () => {
    const src = 'G90\nG0 Z5\nG91 G98\nG81 X1 Y0 Z-1\nX1\n';
    expect(z1Of(src).slice(-8)).toEqual([5, 5, 4, 5, 5, 5, 4, 5]);
    const w = parseGcodeToIR(src).ir.header.warnings.filter((x) => x.code === 'canned-cycle-missing-word');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('no R word');
  });

  it('G99: a later G81 block without R re-applies R from its own current Z (7 + 2 = 9, depth 8)', () => {
    const z = z1Of('G90\nG0 Z5\nG91 G99\nG81 X1 Y0 Z-1 R2\nG81 X1 Y0\n');
    // block 1: at 5, R plane 7 (Z-up, XY, at R, plunge 6, retract 7). block 2: at 7, R plane 9 (Z-up, XY, at R,
    // plunge 8, retract 9).
    expect(z.slice(-10)).toEqual([7, 7, 7, 6, 7, 9, 9, 9, 8, 9]);
  });

  it('G99: a bare X/Y repeat line re-derives both planes too', () => {
    const z = z1Of('G90\nG0 Z5\nG91 G99\nG81 X1 Y0 Z-1 R2\nX1\n');
    expect(z.slice(-5)).toEqual([9, 9, 9, 8, 9]);
  });

  it('G99: a new R with no Z re-derives the depth from the new R plane', () => {
    const z = z1Of('G90\nG0 Z5\nG91 G99\nG81 X1 Y0 Z-1 R2\nG81 X1 Y0 R3\n');
    // block 2 at 7: R plane 10, depth 10 - 1 = 9
    expect(z.slice(-5)).toEqual([10, 10, 10, 9, 10]);
  });

  it('G90 cycles keep their absolute planes when the later block omits R and Z', () => {
    const z = z1Of('G90\nG0 Z5\nG99\nG81 X1 Y0 Z-1 R2\nG81 X1 Y0\n');
    expect(z.slice(-8)).toEqual([5, 2, -1, 2, 2, 2, -1, 2]);
  });
});

describe('unbalanced ( comments', () => {
  const codes = (src: string) =>
    parseGcodeToIR(src).ir.header.warnings.filter((w) => w.code === 'unbalanced-paren-comment');

  it('an unclosed ( warns once per file, with a count', () => {
    const w = codes('G1 X1 (never closed\nG1 X2 (again\nG1 X3');
    expect(w).toHaveLength(1);
    expect(w[0].count).toBe(2);
    expect(w[0].message).toContain('never closed');
  });

  it('a nested ( warns', () => {
    const w = codes('G1 X1 (a (b) c)\n');
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('nested');
  });

  it('balanced comments, a stray ) and parens after a ; comment do not warn', () => {
    expect(codes('G1 X1 (ok)\nG1 X2 ) \nG1 X3 ; note (open\nG1 X4 (a) (b)\n')).toHaveLength(0);
  });

  it('a comment-only line with an unclosed ( warns', () => {
    expect(codes('(never closed\nG1 X1\n')).toHaveLength(1);
  });

  it('Marlin text-argument M-codes (M117, M118, M486, any case) never warn; M73 and T0 still do', () => {
    for (const line of [
      'M117 Printing (50%',
      'M486 AShape (copy',
      'M118 echo (open',
      'm117 lower case (open',
      '  M117 a((b)',
      'M117 Layer 3 (of 10)'
    ])
      expect(codes(`${line}\nG1 X5\n`), line).toHaveLength(0);
    for (const line of ['M73 P10 R5 (estimate', '(Made with Fusion 360 (v2.0))', 'T0 (tool 0', 'M1170 (x', 'M11 (x'])
      expect(codes(`${line}\nG1 X5\n`), line).toHaveLength(1);
  });

  it('an N line-number prefix does not hide a text-argument line: N10 M117 / N20 EXCLUDE_OBJECT_START stay quiet', () => {
    for (const line of ['N10 M117 Printing (50%', 'n10 m117 x (open', 'N10M486 AShape (copy', 'N20 EXCLUDE_OBJECT_START NAME=a_(1'])
      expect(codes(`${line}\nG1 X5\n`), line).toHaveLength(0);
    // an N word before an ordinary code still warns, and a bare N word does not count as a letter pair
    for (const line of ['N10 M73 P10 (estimate', 'N10 G1 X1 (open', 'N10 T0 (tool 0'])
      expect(codes(`${line}\nG1 X5\n`), line).toHaveLength(1);
  });

  it('dialect extended commands with bare parentheses do not warn', () => {
    expect(codes('EXCLUDE_OBJECT_START NAME=cube_(1\nEXCLUDE_OBJECT_DEFINE NAME=a_((b))\nG1 X1\n')).toHaveLength(0);
  });

  it('parsing carries on: geometry after the unclosed ( line is unchanged', () => {
    const { ir } = parseGcodeToIR('G1 X1 Y0 (oops\nG1 X2 Y0\n');
    expect(ir.segments.count).toBe(2);
    expect(Array.from(ir.segments.x1).slice(0, 2)).toEqual([1, 2]);
  });
});

describe('onComment is paren-aware', () => {
  const comments = (src: string) => {
    const out: Array<[string, number]> = [];
    parseGcodeToIR(src, { onComment: (t, b) => out.push([t, b]) });
    return out;
  };

  it('a ; inside ( … ) does not start the comment', () => {
    expect(comments('G1 X1 (a;b) ; real')).toEqual([[' real', 0]]);
  });

  it('a ; inside an unclosed ( is swallowed like the lexer does', () => {
    expect(comments('G1 X1 (a;b')).toEqual([]);
  });

  it('extended commands and text M-codes keep the plain first-; split, so their ( is data', () => {
    expect(comments('EXCLUDE_OBJECT_DEFINE NAME=cube_(1 CENTER=10,10 ; Klipper with comment')).toEqual([
      [' Klipper with comment', 0]
    ]);
    expect(comments('M117 a(b ; real comment')).toEqual([[' real comment', 0]]);
    expect(comments('m117 a(b ; real comment')).toEqual([[' real comment', 0]]);
    expect(comments('M486 AShape (copy ; real comment')).toEqual([[' real comment', 0]]);
    expect(comments('M118 x(y;z) ; c')).toEqual([['z) ; c', 0]]);
    expect(comments('N10 M117 a(b ; real comment')).toEqual([[' real comment', 0]]);
    expect(comments('N10 G1 X1 (a;b) ; real')).toEqual([[' real', 0]]);
    // not a text M-code: M1170 and M11 are paren-aware like any G-code line
    expect(comments('M1170 a(b;c) ; real')).toEqual([[' real', 0]]);
    expect(comments('M11 a(b;c) ; real')).toEqual([[' real', 0]]);
  });

  it('a ; before any ( is unchanged, and later parens stay in the comment text', () => {
    expect(comments('G1 X1 ; note (x;y)')).toEqual([[' note (x;y)', 0]]);
  });

  it('a line without parentheses is unchanged', () => {
    expect(comments('G1 X1 ;hello;there')).toEqual([['hello;there', 0]]);
  });

  it('a stray ) at depth 0 is ignored', () => {
    expect(comments('G1 X1 ) ;c')).toEqual([['c', 0]]);
    // with a real ( on the line, so the paren scan runs: the extra ) must not push the depth below zero
    expect(comments('G1 X1 (a) ) ;c')).toEqual([['c', 0]]);
  });
});

describe('lexer and onComment agree on where the comment is', () => {
  // [line, x1 of the single segment (words the lexer kept), y1, comment text onComment reports (null = none)]
  const table: Array<[string, number, number, string | null]> = [
    ['G1 X1 Y2', 1, 2, null],
    ['G1 X1 (a;b) Y2 ; Z3', 1, 2, ' Z3'],
    ['G1 X1 (a;b Y2', 1, 0, null],
    ['G1 X1 ) Y2 ;c', 1, 2, 'c'],
    ['G1 X1 (a) ) Y2 ;c', 1, 2, 'c'],
    ['G1 X1 ((a;b) Y9) Y2 ;c', 1, 2, 'c'],
    ['G1 X1 ; (Y9;', 1, 0, ' (Y9;'],
    ['G1 (X9) X1 Y2 ;;', 1, 2, ';']
  ];
  it.each(table)('%s', (line, x, y, comment) => {
    const seen: string[] = [];
    const { ir } = parseGcodeToIR(line, { onComment: (t) => seen.push(t) });
    expect(ir.segments.count).toBe(1);
    expect(ir.segments.x1[0]).toBe(x);
    expect(ir.segments.y1[0]).toBe(y);
    expect(seen).toEqual(comment === null ? [] : [comment]);
  });
});

describe('scanParenComments', () => {
  it('reports the first top-level ;, unclosed and nested', () => {
    expect(scanParenComments('a(b;c)d;e')).toEqual({ semi: 7, unclosed: false, nested: false });
    expect(scanParenComments('a(b')).toEqual({ semi: -1, unclosed: true, nested: false });
    expect(scanParenComments('a((b))')).toEqual({ semi: -1, unclosed: false, nested: true });
    expect(scanParenComments('a(b ; c')).toEqual({ semi: -1, unclosed: true, nested: false });
    expect(scanParenComments('a ; (b')).toEqual({ semi: 2, unclosed: false, nested: false });
    expect(scanParenComments('a(b))c;d')).toEqual({ semi: 6, unclosed: false, nested: false });
  });
});
