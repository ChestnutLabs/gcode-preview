/*
 * Non-extrusion toolpath classification — DD-012 phase 1, #189. A FEED move (G1/G2/G3) with no
 * extrusion E while a tool-state modal (M3/M4 spindle/laser on) holds is a Cut (productive); a rapid
 * (G0) stays Travel even while engaged (refined #189); M5 disengages. FDM files (no M3/M4) are
 * byte-identical — Cut is never set and cutMoves is 'unavailable'.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../parse.js';

const cut = (kind: number): boolean => (kind & MoveKind.Cut) !== 0;
const travel = (kind: number): boolean => (kind & MoveKind.Travel) !== 0;
const extrude = (kind: number): boolean => (kind & MoveKind.Extrude) !== 0;
const arc = (kind: number): boolean => (kind & MoveKind.ArcSegment) !== 0;

describe('DD-012 phase 1 — non-extrusion Cut classification (#189)', () => {
  it('laser: no-E moves under M4 are Cut, not Travel; cutMoves is known', () => {
    const gc = ['G21', 'G90', 'M4 S255', 'G1 X10 Y0 F600', 'G1 X10 Y10'].join('\n') + '\n';
    const { ir, stats } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.cutMoves).toBe('known');
    expect(cut(ir.segments.kind[0])).toBe(true);
    expect(cut(ir.segments.kind[1])).toBe(true);
    expect(travel(ir.segments.kind[0])).toBe(false);
    expect(extrude(ir.segments.kind[0])).toBe(false);
    // A cut move carries no extrusion — the FDM extrusion tally must not count it.
    expect(stats.extrusionDistance).toBe(0);
  });

  it('rapid (G0) is Travel even while the tool is engaged; the G1 feed between rapids is Cut', () => {
    // A router keeps its spindle on across rapids and a GRBL-laser gates the beam off during G0, so a
    // rapid is a non-cutting traverse regardless of tool state (DD-012 D2, refined #189). Only the feed
    // move is productive. Mirrors the real GRBL-laser fingerprint (G0 reposition → G1 burn → G0 away).
    const gc = ['M4 S255', 'G0 X10 Y0', 'G1 X20 Y0 F600', 'G0 X30 Y0'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(travel(ir.segments.kind[0])).toBe(true); // G0 reposition — engaged but not cutting
    expect(cut(ir.segments.kind[0])).toBe(false);
    expect(cut(ir.segments.kind[1])).toBe(true); // G1 feed — the actual burn
    expect(travel(ir.segments.kind[2])).toBe(true); // G0 away — engaged but not cutting
    // Modal-motion continuation keeps the rapid classification: a bare-coord line after G0 is a rapid.
    const modal = parseGcodeToIR(['M3 S1000', 'G0 X0 Y0', 'X10 Y0', 'G1 X20 Y0', 'X30 Y0'].join('\n') + '\n', {});
    expect(travel(modal.ir.segments.kind[1])).toBe(true); // bare X/Y under G0 modal → still rapid
    expect(cut(modal.ir.segments.kind[3])).toBe(true); // bare X/Y under G1 modal → cut
  });

  it('M5 disengages the tool: the next no-E move is Travel again', () => {
    const gc = ['M4 S255', 'G1 X10 Y0', 'M5', 'G0 X0 Y0'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(cut(ir.segments.kind[0])).toBe(true); // engaged → Cut
    const last = ir.segments.count - 1;
    expect(travel(ir.segments.kind[last])).toBe(true); // disengaged → Travel
    expect(cut(ir.segments.kind[last])).toBe(false);
  });

  it('spindle arc: an engaged G2 is Cut composed with ArcSegment', () => {
    const gc = ['M3 S1000', 'G1 X10 Y0', 'G2 X20 Y0 I5 J0'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    const arcSeg = [...ir.segments.kind].find((k) => arc(k));
    expect(arcSeg).toBeDefined();
    expect(cut(arcSeg as number)).toBe(true);
    expect(arc(arcSeg as number)).toBe(true);
  });

  it('M03/M05 (leading-zero form) are recognized', () => {
    const gc = ['M03 S1000', 'G1 X5 Y0', 'M05', 'G0 X0 Y0'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(cut(ir.segments.kind[0])).toBe(true);
    expect(travel(ir.segments.kind[ir.segments.count - 1])).toBe(true);
  });

  it('FDM regression: no tool-state ⇒ no Cut, cutMoves unavailable, moves are Extrude/Travel', () => {
    const gc = ['M82', 'G1 X0 Y0 Z0.2 E0', 'G1 X10 E5', 'G1 X20', 'G0 X30'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, {});
    expect(ir.header.capabilities.cutMoves).toBe('unavailable');
    for (let i = 0; i < ir.segments.count; i++) {
      expect(cut(ir.segments.kind[i])).toBe(false);
    }
    expect(extrude(ir.segments.kind[1])).toBe(true); // Δ5 extrude
    expect(travel(ir.segments.kind[2])).toBe(true); // E-unchanged → Travel (unchanged behavior)
  });
});

describe('DD-012 phase 1 — opt-in modal tool-power channel (ModalChannel, #189)', () => {
  it('toolPower: modal S is stamped per segment when requested (incl. inline S)', () => {
    const gc = ['M4 S255', 'G1 X10 Y0', 'G1 X10 Y10 S128'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, { modalChannels: ['toolPower'] });
    expect(ir.header.capabilities.toolPower).toBe('known');
    const tp = ir.segments.modal?.toolPower;
    expect(tp).toBeDefined();
    expect(tp![0]).toBe(255); // power from M4 S255
    expect(tp![1]).toBe(128); // inline G1 … S128 latches the modal register
  });

  it('toolPower is NaN while the tool is off (after M5)', () => {
    const gc = ['M4 S255', 'G1 X10 Y0', 'M5', 'G0 X0 Y0'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, { modalChannels: ['toolPower'] });
    const tp = ir.segments.modal!.toolPower;
    expect(tp[0]).toBe(255);
    expect(Number.isNaN(tp[ir.segments.count - 1])).toBe(true); // disengaged → no power value
  });

  it('opt-out (default parse): no modal on the IR and no toolPower capability', () => {
    const { ir } = parseGcodeToIR(['M4 S255', 'G1 X10 Y0'].join('\n') + '\n', {});
    expect(ir.segments.modal).toBeUndefined();
    expect(ir.header.capabilities.toolPower).toBeUndefined();
  });

  it('FDM requesting toolPower: capability unavailable, column all NaN (never fabricated 0)', () => {
    const gc = ['M82', 'G1 X0 Y0 E0', 'G1 X10 E5', 'G1 X20 E10'].join('\n') + '\n';
    const { ir } = parseGcodeToIR(gc, { modalChannels: ['toolPower'] });
    expect(ir.header.capabilities.toolPower).toBe('unavailable');
    const tp = ir.segments.modal!.toolPower;
    for (let i = 0; i < ir.segments.count; i++) expect(Number.isNaN(tp[i])).toBe(true);
  });

  it('unknown modal channel is ignored with a warning', () => {
    const { ir, stats } = parseGcodeToIR(['M4 S255', 'G1 X10 Y0'].join('\n') + '\n', {
      modalChannels: ['bogus']
    });
    expect(ir.segments.modal).toBeUndefined();
    expect(stats.warningsByCode['modal-channel-unsupported']).toBeGreaterThan(0);
  });
});

describe('DD-012 phase 2 — modal motion continuation (#189)', () => {
  it('a bare coordinate line repeats the last G1 motion (was dropped entirely)', () => {
    const { ir } = parseGcodeToIR('G1 X0 Y0 F600\nX10 Y0\nX20 Y0\n', {});
    expect(ir.segments.count).toBe(3); // was 1 before modal-motion support
    expect(ir.segments.x1[2]).toBeCloseTo(20);
  });

  it('bare coordinate line repeats G0 rapids too', () => {
    const { ir } = parseGcodeToIR('G0 X0 Y0\nX5 Y0\nX10 Y0\n', {});
    expect(ir.segments.count).toBe(3);
    expect(travel(ir.segments.kind[2])).toBe(true);
  });

  it('modal continuation preserves Cut classification when engaged', () => {
    const { ir } = parseGcodeToIR('M4 S255\nG1 X0 Y0 F600\nX10 Y0\nX10 Y10\n', {});
    expect(ir.segments.count).toBe(3);
    for (let i = 0; i < ir.segments.count; i++) expect(cut(ir.segments.kind[i])).toBe(true);
  });

  it('inline S on a modal-continuation line latches toolPower', () => {
    const { ir } = parseGcodeToIR('M4 S255\nG1 X0 Y0\nX10 Y0 S100\n', { modalChannels: ['toolPower'] });
    const tp = ir.segments.modal!.toolPower;
    expect(tp[0]).toBe(255);
    expect(tp[1]).toBe(100);
  });

  it('inert before any motion mode: a leading coordinate line emits nothing', () => {
    const { ir } = parseGcodeToIR('X10 Y0\nG1 X20 Y0\n', {});
    expect(ir.segments.count).toBe(1); // the pre-mode coordinate line is dropped; only the G1 emits
  });
});

describe('DD-012 phase 2 — canned drilling cycles (#189)', () => {
  const minZ1 = (ir: { segments: { count: number; z1: Float32Array } }): number => {
    let m = Infinity;
    for (let i = 0; i < ir.segments.count; i++) m = Math.min(m, ir.segments.z1[i]);
    return m;
  };

  it('G81 expands to rapid/plunge/retract, with a Cut plunge to depth', () => {
    const { ir } = parseGcodeToIR('G0 X0 Y0 Z5\nG81 X10 Y10 Z-5 R2 F100\nG80\n', {});
    expect(ir.header.capabilities.cannedCycles).toBe('known');
    let sawCut = false;
    for (let i = 0; i < ir.segments.count; i++) if (cut(ir.segments.kind[i])) sawCut = true;
    expect(sawCut).toBe(true);
    expect(minZ1(ir)).toBeCloseTo(-5); // the plunge reaches Z-5
  });

  it('modal repeat: a bare X/Y line drills another hole (4 more sub-moves)', () => {
    const one = parseGcodeToIR('G0 X0 Y0 Z5\nG81 X10 Y10 Z-5 R2 F100\nG80\n', {}).ir.segments.count;
    const two = parseGcodeToIR('G0 X0 Y0 Z5\nG81 X10 Y10 Z-5 R2 F100\nX20 Y10\nG80\n', {}).ir.segments.count;
    expect(two).toBe(one + 4);
  });

  it('retract plane: G98 → initial Z, G99 → R plane', () => {
    const g98 = parseGcodeToIR('G0 X0 Y0 Z5\nG98\nG81 X10 Y10 Z-5 R2\nG80\n', {}).ir.segments;
    const g99 = parseGcodeToIR('G0 X0 Y0 Z5\nG99\nG81 X10 Y10 Z-5 R2\nG80\n', {}).ir.segments;
    expect(g98.z1[g98.count - 1]).toBeCloseTo(5); // retract to the initial plane
    expect(g99.z1[g99.count - 1]).toBeCloseTo(2); // retract to the R plane
  });

  it('G83 peck drilling produces multiple Cut plunges reaching depth', () => {
    const { ir } = parseGcodeToIR('G0 X0 Y0 Z5\nG83 X0 Y0 Z-6 R2 Q2 F100\nG80\n', {});
    let cutCount = 0;
    for (let i = 0; i < ir.segments.count; i++) if (cut(ir.segments.kind[i])) cutCount++;
    expect(cutCount).toBeGreaterThan(1); // one Cut per peck
    expect(minZ1(ir)).toBeCloseTo(-6);
  });

  it('G82 (dwell drill) expands to a single Cut plunge to depth (#277/M5)', () => {
    // G82 is routed in the parser but was untested — it drills like G81 (the dwell P is a no-op here).
    const { ir } = parseGcodeToIR('G0 X0 Y0 Z5\nG82 X0 Y0 Z-4 R2 P50 F100\nG80\n', {});
    expect(ir.header.capabilities.cannedCycles).toBe('known');
    let cutCount = 0;
    for (let i = 0; i < ir.segments.count; i++) if (cut(ir.segments.kind[i])) cutCount++;
    expect(cutCount).toBe(1); // single plunge (not a peck loop)
    expect(minZ1(ir)).toBeCloseTo(-4);
  });

  it('G80 cancels: a following bare coordinate line drills nothing', () => {
    const active = parseGcodeToIR('G0 X0 Y0 Z5\nG81 X10 Y10 Z-5 R2\nX20 Y10\n', {}).ir.segments.count;
    const cancelled = parseGcodeToIR('G0 X0 Y0 Z5\nG81 X10 Y10 Z-5 R2\nG80\nX20 Y10\n', {}).ir.segments.count;
    expect(active).toBe(cancelled + 4); // the post-G80 line adds no hole
  });

  it('FDM regression: no canned cycles ⇒ cannedCycles unavailable', () => {
    const { ir } = parseGcodeToIR('M82\nG1 X0 Y0 E0\nG1 X10 E5\n', {});
    expect(ir.header.capabilities.cannedCycles).toBe('unavailable');
  });
});
