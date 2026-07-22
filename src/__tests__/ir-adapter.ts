import { describe, it, expect } from 'vitest';
import { MoveKind } from '@chestnutlabs/toolpath-core';
import { Parser } from '../gcode-parser';
import { Interpreter } from '../interpreter';
import { Job } from '../job';
import { jobToToolpathIR } from '../ir-adapter';

function parseToJob(gcode: string): Job {
  const parser = new Parser();
  const { commands } = parser.parseGCode(gcode);
  const job = new Job();
  new Interpreter().execute(commands, job);
  job.finishPath();
  return job;
}

const SIMPLE_GCODE = [
  'G0 X0 Y0 Z0.2',
  'G1 X10 Y0 E1',
  'G1 X10 Y10 E2',
  'G0 X20 Y20', // travel
  'G0 X0 Y0 Z0.4',
  'G1 X10 Y0 E3'
].join('\n');

describe('jobToToolpathIR (inherited-structures adapter, #29)', () => {
  it('converts a parsed job into a ToolpathIR with segments, layers and bounds', () => {
    const job = parseToJob(SIMPLE_GCODE);
    const ir = jobToToolpathIR(job, { parserVersion: 'test', source: { byteLength: SIMPLE_GCODE.length } });

    expect(ir.segments.count).toBeGreaterThan(0);
    expect(ir.segments.x0).toBeInstanceOf(Float32Array);

    // Both extrude and travel segments are represented.
    const kinds = Array.from(ir.segments.kind);
    expect(kinds.some((k) => (k & MoveKind.Extrude) !== 0)).toBe(true);
    expect(kinds.some((k) => (k & MoveKind.Travel) !== 0)).toBe(true);

    // Two extrusion layers (z 0.2 and 0.4) come from the inherited layer index.
    expect(ir.layers.length).toBe(job.layers.length);
    // The inherited LayersIndexer only indexes extrusion paths, so travel paths get
    // their layer carried forward -> the adapter honestly reports 'inferred', not 'known'.
    expect(ir.header.capabilities.layers).toBe('inferred');
    expect(ir.header.warnings.some((w) => w.code === 'layers-partially-inferred')).toBe(true);

    // Extrude-only bounds cover the extrusion square, not the travel excursion to (20,20).
    expect(ir.bounds.max.x).toBeCloseTo(10);
    expect(ir.bounds.max.y).toBeCloseTo(10);
    expect(ir.boundsWithTravel.max.x).toBeCloseTo(20);
  });

  it('reports data the inherited structures cannot supply as unavailable, never fabricated', () => {
    const job = parseToJob(SIMPLE_GCODE);
    const ir = jobToToolpathIR(job);

    expect(ir.header.capabilities.extrusionDelta).toBe('unavailable');
    expect(ir.header.capabilities.feedrate).toBe('unavailable');
    expect(ir.header.capabilities.sourcePositions).toBe('unavailable');
    expect(ir.header.capabilities.featureRoles).toBe('unavailable');
    expect(Number.isNaN(ir.segments.feedrate[0])).toBe(true);
    expect(ir.header.warnings.some((w) => w.code === 'adapter-lossy-source')).toBe(true);
  });

  it('matches the inherited counts for the demo-scale smoke case', () => {
    // A vase-like spiral: many small extrusion segments across two layers.
    const lines: string[] = ['G0 X0 Y0 Z0.2'];
    for (let i = 1; i <= 100; i++) {
      lines.push(`G1 X${(i % 10) + 1} Y${i % 7} E${i}`);
    }
    lines.push('G0 X0 Y0 Z0.4');
    for (let i = 1; i <= 50; i++) {
      lines.push(`G1 X${(i % 10) + 1} Y${i % 7} E${100 + i}`);
    }
    const job = parseToJob(lines.join('\n'));
    const ir = jobToToolpathIR(job);

    // Segment count equals the sum over paths of (vertexCount - 1).
    const expected = job.paths.reduce((acc, p) => acc + Math.max(0, p.vertices.length / 3 - 1), 0);
    expect(ir.segments.count).toBe(expected);
    expect(ir.sourceIndex.byteOffsets.length).toBe(ir.segments.count);
  });
});
