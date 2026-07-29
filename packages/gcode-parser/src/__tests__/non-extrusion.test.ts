/*
 * Non-extrusion toolpath classification — DD-012 phase 1, #189. A move with no extrusion E while a
 * tool-state modal (M3/M4 spindle/laser on) holds is a Cut (productive), not a Travel; M5 disengages.
 * FDM files (no M3/M4) are byte-identical — Cut is never set and cutMoves is 'unavailable'.
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
