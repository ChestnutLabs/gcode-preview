import { describe, expect, it } from 'vitest';
import { IR_SCHEMA_VERSION, MoveKind, ToolpathIRBuilder } from '../index';

describe('ToolpathIRBuilder', () => {
  it('builds a ToolpathIR with typed-array segments and a floating origin', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    b.addSegment({
      x0: 100,
      y0: 100,
      z0: 0.2,
      x1: 110,
      y1: 100,
      z1: 0.2,
      e: 5,
      feedrate: 1200,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: 10
    });
    b.addSegment({
      x0: 110,
      y0: 100,
      z0: 0.2,
      x1: 110,
      y1: 110,
      z1: 0.2,
      feedrate: 3000,
      kind: MoveKind.Travel,
      layer: 0,
      srcByte: 20
    });
    b.addSegment({
      x0: 110,
      y0: 110,
      z0: 0.4,
      x1: 120,
      y1: 110,
      z1: 0.4,
      e: 5,
      kind: MoveKind.Extrude,
      layer: 1,
      srcByte: 30
    });
    const ir = b.finalize();

    expect(ir.header.irSchemaVersion).toBe(IR_SCHEMA_VERSION);
    expect(ir.header.parserVersion).toBe('test');
    expect(ir.segments.count).toBe(3);
    expect(ir.segments.x0).toBeInstanceOf(Float32Array);
    expect(ir.segments.kind).toBeInstanceOf(Uint8Array);
    expect(ir.segments.srcByte).toBeInstanceOf(Uint32Array);

    // Floating origin: the first segment start becomes the (0,0,0) delta.
    expect(ir.header.originOffset).toEqual({ x: 100, y: 100, z: 0.2 });
    expect(ir.segments.x0[0]).toBeCloseTo(0);
    expect(ir.segments.x1[0]).toBeCloseTo(10);

    // Extrude-only bounds (absolute): extrude moves span x 100..120, y 100..110.
    expect(ir.bounds.min.x).toBeCloseTo(100);
    expect(ir.bounds.max.x).toBeCloseTo(120);
    expect(ir.bounds.max.y).toBeCloseTo(110);
    // Travel-inclusive bounds also reach y 110 (the travel move).
    expect(ir.boundsWithTravel.max.y).toBeCloseTo(110);

    // Two layers, second at absolute z 0.4.
    expect(ir.layers.length).toBe(2);
    expect(ir.layers[0].segStart).toBe(0);
    expect(ir.layers[1].z).toBeCloseTo(0.4);
  });

  it('represents unknown data as unavailable/NaN, not fabricated values', () => {
    const b = new ToolpathIRBuilder();
    b.setCapability('featureRoles', 'unavailable');
    b.addSegment({ x0: 0, y0: 0, z0: 0, x1: 1, y1: 0, z1: 0, kind: MoveKind.Extrude, layer: 0, srcByte: 0 });
    const ir = b.finalize();

    expect(ir.header.capabilities.featureRoles).toBe('unavailable');
    expect(ir.header.unitsSource).toBe('unavailable');
    expect(Number.isNaN(ir.segments.feedrate[0])).toBe(true);
    expect(ir.segments.feature[0]).toBe(0);
    expect(ir.tools).toHaveLength(0);
  });
});
