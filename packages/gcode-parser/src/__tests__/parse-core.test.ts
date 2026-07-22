import { describe, expect, it } from 'vitest';
import { MoveKind, segmentAtByte } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../index';

describe('parse core (DD-003 phase 1)', () => {
  it('parses linear moves with real e, feedrate and srcByte', () => {
    const gcode = ['G0 X0 Y0 Z0.2', 'G1 X10 Y0 E1.5 F1200', 'G1 X10 Y10 E2.5'].join('\n');
    const { ir, stats } = parseGcodeToIR(gcode);

    expect(ir.header.complete).toBe(true);
    expect(ir.segments.count).toBe(3);
    // Segment 1 (G1 X10 E1.5 F1200): extrusion with the command's delta + modal feed.
    expect(ir.segments.e[1]).toBeCloseTo(1.5);
    expect(ir.segments.feedrate[1]).toBe(1200);
    expect(ir.segments.kind[1] & MoveKind.Extrude).toBeTruthy();
    // Segment 0 (G0 travel): no e; feedrate unknown before the first F.
    expect(ir.segments.kind[0] & MoveKind.Travel).toBeTruthy();
    expect(Number.isNaN(ir.segments.feedrate[0])).toBe(true);
    // Modal feed persists onto segment 2.
    expect(ir.segments.feedrate[2]).toBe(1200);
    expect(stats.extrusionDistance).toBeCloseTo(4);
    expect(ir.header.capabilities.sourcePositions).toBe('known');
  });

  it('tracks srcByte accurately: segmentAtByte maps an offset to the producing command', () => {
    const lines = ['G0 X0 Y0 Z0.2', 'G1 X5 Y0 E1', 'G1 X5 Y5 E2'];
    const gcode = lines.join('\n');
    const { ir } = parseGcodeToIR(gcode);
    // Byte offset of line 2 (start of 'G1 X5 Y0 E1'):
    const line1Offset = lines[0].length + 1;
    expect(ir.segments.srcByte[1]).toBe(line1Offset);
    expect(segmentAtByte(ir.sourceIndex, line1Offset)).toBe(1);
    // An offset inside line 2 still resolves to segment 1 (in progress).
    expect(segmentAtByte(ir.sourceIndex, line1Offset + 3)).toBe(1);
  });

  it('handles units (G20/G21), homing (G28) and tool changes (T0..T7)', () => {
    const gcode = ['G20', 'G0 X1 Y1 Z0.1', 'T3', 'G1 X2 Y2 E1', 'G28', 'G1 X1 Y0 E1'].join('\n');
    const { ir } = parseGcodeToIR(gcode);
    expect(ir.header.units).toBe('in');
    expect(ir.header.unitsSource).toBe('known');
    // Tool captured at path creation: the T3 change breaks nothing by itself,
    // but the next extrusion path carries tool 3.
    expect(ir.tools.map((t) => t.id)).toContain(3);
    // Inherited G28 semantics: homing sets STATE to (0,0,0) but emits no vertex —
    // the post-home segment still starts from the last emitted vertex (2,2),
    // jumping to the new state-derived endpoint. Quirk preserved by the port.
    const last = ir.segments.count - 1;
    expect(ir.header.originOffset.x + ir.segments.x0[last]).toBeCloseTo(2);
    expect(ir.header.originOffset.x + ir.segments.x1[last]).toBeCloseTo(1);
  });

  it('flattens G2 arcs into ARC_SEGMENT-flagged segments distributing e', () => {
    // Quarter arc from (0,0) to (10,10) centered at (0,10).
    const gcode = ['G0 X0 Y0 Z0.2', 'G2 X10 Y10 I0 J10 E4'].join('\n');
    const { ir } = parseGcodeToIR(gcode);
    const arcSegs = Array.from(ir.segments.kind).filter((k) => k & MoveKind.ArcSegment).length;
    expect(arcSegs).toBeGreaterThan(10); // r=10, quarter → ~31 segments at 0.5mm
    // e distributed across arc segments sums to the command's e.
    let eSum = 0;
    for (let i = 0; i < ir.segments.count; i++) eSum += ir.segments.e[i];
    expect(eSum).toBeCloseTo(4, 1);
    // End point reached.
    const last = ir.segments.count - 1;
    expect(ir.header.originOffset.x + ir.segments.x1[last]).toBeCloseTo(10);
    expect(ir.header.originOffset.y + ir.segments.y1[last]).toBeCloseTo(10);
  });

  it('preserves unsupported commands as warnings, never fatal', () => {
    const gcode = ['M104 S200', 'G0 X0 Y0 Z0.2', 'M900 K0.05', 'G1 X5 E1'].join('\n');
    const { ir, stats } = parseGcodeToIR(gcode);
    expect(ir.header.complete).toBe(true);
    expect(ir.segments.count).toBe(2);
    expect(stats.warningsByCode['unsupported-command']).toBe(2);
    const w = ir.header.warnings.find((w) => w.code === 'unsupported-command');
    expect(w?.count).toBe(2);
  });

  it('vase-mode-like continuous z rise does NOT clear layers (consecutive-step check)', () => {
    const lines = ['G0 X0 Y0 Z0.2'];
    // 200 tiny extruding steps, z rising 0.002 per step (< 0.05 tolerance per step,
    // > tolerance in total): inherited semantics keep this planar-indexed.
    for (let i = 1; i <= 200; i++) {
      lines.push(`G1 X${i % 10} Y${(i * 3) % 10} Z${(0.2 + i * 0.002).toFixed(3)} E${i}`);
    }
    const { ir } = parseGcodeToIR(lines.join('\n'));
    expect(ir.header.capabilities.layers).not.toBe('unavailable');
    expect(ir.layers.length).toBeGreaterThan(0);
  });

  it('a hard z jump inside an extrusion path clears the layer index (non-planar)', () => {
    const gcode = ['G0 X0 Y0 Z0.2', 'G1 X5 Y0 E1', 'G1 X5 Y5 Z5 E2', 'G1 X0 Y5 E3'].join('\n');
    const { ir } = parseGcodeToIR(gcode);
    expect(ir.header.capabilities.layers).toBe('unavailable');
    expect(Array.from(ir.segments.layer).every((l) => l === 0)).toBe(true);
    expect(ir.header.warnings.some((w) => w.code === 'layers-cleared-non-planar')).toBe(true);
  });

  it('enforces maxSegments with a structured bounded partial result', () => {
    const lines = ['G0 X0 Y0 Z0.2'];
    for (let i = 1; i <= 100; i++) lines.push(`G1 X${i} Y0 E${i}`);
    const { ir, stats } = parseGcodeToIR(lines.join('\n'), { limits: { maxSegments: 10 } });
    expect(ir.header.complete).toBe(false);
    expect(ir.header.truncatedAtByte).toBeGreaterThan(0);
    expect(ir.segments.count).toBe(10);
    expect(stats.stopReason?.code).toBe('E_LIMIT_SEGMENTS');
  });

  it('enforces the cumulative allocation budget with a structured bounded result', () => {
    const lines = ['G0 X0 Y0 Z0.2'];
    for (let i = 1; i <= 100000; i++) lines.push(`G1 X${i % 100} Y${i % 77} E${i}`);
    // Tiny budget: the writer cannot even double once past the initial capacity.
    const { ir, stats } = parseGcodeToIR(lines.join('\n'), { limits: { maxBufferBytes: 400_000 } });
    expect(ir.header.complete).toBe(false);
    expect(stats.stopReason?.code).toBe('E_LIMIT_BUFFER_BYTES');
    // The bounded partial is still a valid IR with everything parsed so far.
    expect(ir.segments.count).toBeGreaterThan(0);
    expect(ir.sourceIndex.byteOffsets.length).toBe(ir.segments.count);
  });

  it('enforces maxInputBytes upfront', () => {
    const { ir, stats } = parseGcodeToIR('G0 X0 Y0 Z1\nG1 X1 E1', { limits: { maxInputBytes: 5 } });
    expect(ir.header.complete).toBe(false);
    expect(ir.segments.count).toBe(0);
    expect(stats.stopReason?.code).toBe('E_LIMIT_INPUT_BYTES');
  });
});
