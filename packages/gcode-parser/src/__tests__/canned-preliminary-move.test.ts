/*
 * Canned-cycle preliminary Z move. LinuxCNC g-code.html §43.6 (Preliminary and In-Between Motion), verbatim:
 *
 *   "Preliminary motion is a set of motions that is common to all of the milling canned cycles. If the
 *   current Z position is below the R position, the Z axis does a rapid move to the R position. This happens
 *   only once, regardless of the value of L. In addition, at the beginning of the first cycle and each
 *   repeat, the following one or two moves are made: A rapid move parallel to the XY-plane to the given
 *   XY-position. The Z-axis make a rapid move to the R position, if it is not already at the R position."
 *
 * G81 Example 2 (relative): `G91 G98 G81 X4 Y5 Z-0.6 R1.8 L3`, "Suppose the current position is (X1, Y2, Z3)".
 *   "The initial X position is 5 (=1+4), the initial Y position is 7 (=2+5), the clear Z position is 4.8
 *   (=1.8+3), and the Z position is 4.2 (=4.8-0.6). OLD_Z is 3. The first preliminary move is a maximum rapid
 *   move along the Z axis to (X1,Y2,Z4.8), since OLD_Z < clear Z." Then each repeat: "A rapid move parallel
 *   to the XY-plane to (X5, Y7)", "Move parallel to the Z-axis at the feed rate to (Z4.2)", "A rapid move
 *   parallel to the Z-axis to (X5, Y7, Z4.8)"; holes (9,12) and (13,17) the same at Z4.8.
 *
 * G81 Example 3: `G90 G98 G81 X4 Y5 Z1.5 R2.8` from (X0,Y0,Z0): "since the initial value of Z is less than the
 *   value specified in R, there will be an initial Z move during the preliminary moves."
 *
 * The parser does not model L, so the three holes of Example 2 are pinned as the same cycle in absolute mode
 * (G90 X5 Y7 / X9 Y12 / X13 Y17, R4.8, Z4.2), which is exactly the geometry LinuxCNC lists.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../parse.js';

type Row = [x: number, y: number, z: number, k: 'T' | 'C'];

/** All segments after the setup moves, as [x1, y1, z1, T(ravel)|C(ut)] rounded to 4 decimals. */
function rowsAfter(src: string, skip: number): Row[] {
  const { ir } = parseGcodeToIR(src);
  const s = ir.segments;
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const out: Row[] = [];
  for (let i = skip; i < s.count; i++) {
    out.push([r(s.x1[i]), r(s.y1[i]), r(s.z1[i]), (s.kind[i] & MoveKind.Cut) !== 0 ? 'C' : 'T']);
  }
  return out;
}

describe('canned cycle preliminary Z-up move (LinuxCNC §43.6)', () => {
  it('Example 2 (G91 G98) first hole: Z up to 4.8 at (1,2), then XY at 4.8, plunge to 4.2, retract to 4.8', () => {
    // setup: `G0 X1 Y2 Z3` is segment 0 (one segment); the cycle is everything after it.
    expect(rowsAfter('G90\nG0 X1 Y2 Z3\nG91 G98\nG81 X4 Y5 Z-0.6 R1.8\n', 1)).toEqual([
      [1, 2, 4.8, 'T'], // the preliminary move: (X1,Y2,Z4.8)
      [5, 7, 4.8, 'T'], // rapid XY to (X5, Y7) at the clear Z
      [5, 7, 4.8, 'T'], // Z to R: already there
      [5, 7, 4.2, 'C'], // feed to Z4.2
      [5, 7, 4.8, 'T'] // rapid to Z4.8
    ]);
  });

  it('Example 2 geometry, all three holes (absolute form): the Z-up happens once, then every hole is XY at 4.8', () => {
    const src = 'G90\nG0 X1 Y2 Z3\nG98\nG81 X5 Y7 Z4.2 R4.8\nX9 Y12\nX13 Y17\n';
    expect(rowsAfter(src, 1)).toEqual([
      [1, 2, 4.8, 'T'], // preliminary Z move, once
      [5, 7, 4.8, 'T'],
      [5, 7, 4.8, 'T'],
      [5, 7, 4.2, 'C'],
      [5, 7, 4.8, 'T'],
      [9, 12, 4.8, 'T'], // second hole: no Z-up, XY rapid at 4.8
      [9, 12, 4.8, 'T'],
      [9, 12, 4.2, 'C'],
      [9, 12, 4.8, 'T'],
      [13, 17, 4.8, 'T'], // third hole
      [13, 17, 4.8, 'T'],
      [13, 17, 4.2, 'C'],
      [13, 17, 4.8, 'T']
    ]);
  });

  it('Example 3 (G90 G98) from (0,0,0): initial Z move to R 2.8 at (0,0), then XY to (4,5)', () => {
    // `G0 X0 Y0 Z0` is a no-motion first move; count whatever it emits as setup (one segment).
    expect(rowsAfter('G90\nG0 X0 Y0 Z0\nG98\nG81 X4 Y5 Z1.5 R2.8\n', 1)).toEqual([
      [0, 0, 2.8, 'T'],
      [4, 5, 2.8, 'T'],
      [4, 5, 2.8, 'T'],
      [4, 5, 1.5, 'C'],
      [4, 5, 2.8, 'T']
    ]);
  });

  it('G98 with the start Z above R: no preliminary move (XY at the start Z, then down to R, retract to start Z)', () => {
    expect(rowsAfter('G90\nG0 X1 Y2 Z5\nG98\nG81 X4 Y5 Z-1 R2\n', 1)).toEqual([
      [4, 5, 5, 'T'],
      [4, 5, 2, 'T'],
      [4, 5, -1, 'C'],
      [4, 5, 5, 'T']
    ]);
  });

  it('G99 with the start Z above R: no preliminary move either', () => {
    expect(rowsAfter('G90\nG0 X1 Y2 Z5\nG99\nG81 X4 Y5 Z-1 R2\n', 1)).toEqual([
      [4, 5, 5, 'T'],
      [4, 5, 2, 'T'],
      [4, 5, -1, 'C'],
      [4, 5, 2, 'T']
    ]);
  });

  it('start Z exactly at R: no preliminary move', () => {
    expect(rowsAfter('G90\nG0 X1 Y2 Z2\nG99\nG81 X4 Y5 Z-1 R2\n', 1)[0]).toEqual([4, 5, 2, 'T']);
  });

  it('G83 peck cycle also gets the Z-up when the start Z is below R', () => {
    const rows = rowsAfter('G90\nG0 X1 Y2 Z0\nG99\nG83 X4 Y5 Z-2 R3 Q1\n', 1);
    expect(rows.slice(0, 3)).toEqual([
      [1, 2, 3, 'T'],
      [4, 5, 3, 'T'],
      [4, 5, 3, 'T']
    ]);
  });
});
