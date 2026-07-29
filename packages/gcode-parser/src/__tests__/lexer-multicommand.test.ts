/*
 * Multi-command lines, N-word line numbers, and bare S/F words (#189 lexer). Real CNC/laser G-code
 * (GRBL, LinuxCNC, TinyG, Mach3, Fanuc) routinely puts several commands on one line, prefixes lines
 * with N line numbers, and sets power/feed on bare `S`/`F` lines — none of which the FDM-shaped
 * first-word lexer handled. FDM output is unchanged (slicers emit one clean command per line).
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../parse.js';

const cut = (k: number): boolean => (k & MoveKind.Cut) !== 0;

describe('#189 lexer — multi-command / line numbers / bare words', () => {
  it('multiple G commands on one line all apply (G21 G90 G1 …)', () => {
    const { ir } = parseGcodeToIR('G21 G90 G1 X10 Y0 F100\n', {});
    expect(ir.segments.count).toBe(1);
    expect(ir.segments.x1[0]).toBeCloseTo(10);
  });

  it('a spindle command sharing a line (S3400 M3) is not lost → tool engaged, Cut', () => {
    const { ir } = parseGcodeToIR('S3400 M3\nG1 X10 Y0 F100\nG1 X10 Y10\n', { modalChannels: ['toolPower'] });
    expect(ir.header.capabilities.cutMoves).toBe('known');
    expect(cut(ir.segments.kind[0])).toBe(true);
    expect(ir.segments.modal!.toolPower[0]).toBe(3400); // S captured from the shared line
  });

  it('N-word line numbers are stripped (Fanuc/Mach/TinyG)', () => {
    const { ir } = parseGcodeToIR('N10 G1 X10 Y0 F100\nN20 X20 Y0\nN30 X30\n', {});
    expect(ir.segments.count).toBe(3); // all three moves parse; N is ignored, modal motion continues
    expect(ir.segments.x1[2]).toBeCloseTo(30);
  });

  it('a bare S line updates the modal tool power', () => {
    const { ir } = parseGcodeToIR('M3 S0\nS1000\nG1 X10 Y0 F100\n', { modalChannels: ['toolPower'] });
    expect(ir.segments.modal!.toolPower[0]).toBe(1000); // the cut takes the bare-S power, not M3 S0
  });

  it('a bare F line sets the modal feed for the next move', () => {
    const { ir } = parseGcodeToIR('G1 X0 Y0\nF250\nX10 Y0\n', {});
    expect(ir.segments.feedrate[ir.segments.count - 1]).toBeCloseTo(250);
  });

  it('M486 T<count> does NOT change the tool (T is the M486 param, not a tool select)', () => {
    const { ir } = parseGcodeToIR('M486 T2\nG1 X0 Y0 E0\nG1 X10 E1\n', {});
    for (let i = 0; i < ir.segments.count; i++) expect(ir.segments.tool[i]).toBe(0);
  });

  it('a LEADING T is a tool select (T1 M6)', () => {
    const { ir } = parseGcodeToIR('T1 M6\nG1 X0 Y0 E0\nG1 X10 E1\n', {});
    expect(ir.segments.tool[ir.segments.count - 1]).toBe(1);
  });

  it('extended-command words with embedded letters emit no spurious motion', () => {
    // The `G` in POLYGON / `T` in OBJECT must not become commands (no digit follows them).
    const gc = 'G0 X0 Y0\nEXCLUDE_OBJECT_DEFINE NAME=c POLYGON=[[0,0],[9,9]]\nG1 X10 Y0\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.segments.count).toBe(2); // only the G0 + G1; the EXCLUDE line produces no segment
  });
});
