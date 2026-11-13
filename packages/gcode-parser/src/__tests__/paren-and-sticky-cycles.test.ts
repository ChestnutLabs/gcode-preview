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
  it('LinuxCNC G81 incremental example: each hole clears at current Z + R and drills R + Z', () => {
    // LinuxCNC docs: from (1,2,3), `G91 G81 X4 Y5 Z-0.6 R1.8` → clear Z 4.8, hole bottom 4.2, retract to 3 (G98).
    const src = 'G90\nG0 X1 Y2 Z3\nG91 G98\nG81 X4 Y5 Z-0.6 R1.8\nG81 X4 Y5\n';
    const z = z1Of(src);
    const tail = z.slice(-8);
    const expected = [3, 4.8, 4.2, 3, 3, 4.8, 4.2, 3];
    expect(tail).toHaveLength(8);
    tail.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
  });

  it('G99: a later G81 block without R re-applies R from its own current Z (7 + 2 = 9, depth 8)', () => {
    const z = z1Of('G90\nG0 Z5\nG91 G99\nG81 X1 Y0 Z-1 R2\nG81 X1 Y0\n');
    // block 1: at 5, R plane 7, depth 6, retract to R (7). block 2: at 7, R plane 9, depth 8, retract to 9.
    expect(z.slice(-8)).toEqual([5, 7, 6, 7, 7, 9, 8, 9]);
  });

  it('G99: a bare X/Y repeat line re-derives both planes too', () => {
    const z = z1Of('G90\nG0 Z5\nG91 G99\nG81 X1 Y0 Z-1 R2\nX1\n');
    expect(z.slice(-4)).toEqual([7, 9, 8, 9]);
  });

  it('G99: a new R with no Z re-derives the depth from the new R plane', () => {
    const z = z1Of('G90\nG0 Z5\nG91 G99\nG81 X1 Y0 Z-1 R2\nG81 X1 Y0 R3\n');
    // block 2 at 7: R plane 10, depth 10 - 1 = 9
    expect(z.slice(-4)).toEqual([7, 10, 9, 10]);
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
