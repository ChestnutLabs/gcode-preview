import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, createProgressMapper, type SegmentInput } from '../index';

/** A 1 mm extrusion at height `z` on `layer`. */
function seg(layer: number, z: number, extra: Partial<SegmentInput> = {}): SegmentInput {
  return {
    x0: 0,
    y0: 0,
    z0: z,
    x1: 1,
    y1: 0,
    z1: z,
    e: 1,
    feedrate: 600,
    kind: MoveKind.Extrude,
    layer,
    srcByte: 0,
    ...extra
  };
}

describe('ToolpathIRBuilder channel range checks (sweep G2)', () => {
  const cases: [string, Partial<SegmentInput>, string][] = [
    ['kind 256', { kind: 256 }, 'kind must be an integer in [0, 255] (got 256)'],
    ['kind -1', { kind: -1 }, 'kind must be an integer in [0, 255] (got -1)'],
    ['kind 1.5', { kind: 1.5 }, 'kind must be an integer in [0, 255] (got 1.5)'],
    ['tool 65536', { tool: 65536 }, 'tool must be an integer in [0, 65535] (got 65536)'],
    ['tool NaN', { tool: NaN }, 'tool must be an integer in [0, 65535] (got NaN)'],
    ['feature 256', { feature: 256 }, 'feature must be an integer in [0, 255] (got 256)'],
    ['object -1', { object: -1 }, 'object must be an integer in [0, 4294967295] (got -1)'],
    ['object 2^32', { object: 4294967296 }, 'object must be an integer in [0, 4294967295] (got 4294967296)'],
    ['srcByte 2^32+5', { srcByte: 4294967301 }, 'srcByte must be an integer in [0, 4294967295] (got 4294967301)'],
    ['srcByte Infinity', { srcByte: Infinity }, 'srcByte must be an integer in [0, 4294967295] (got Infinity)'],
    ['layer -1', { layer: -1 }, 'layer must be an integer in [0, 4294967295] (got -1)'],
    ['layer 0.5', { layer: 0.5 }, 'layer must be an integer in [0, 4294967295] (got 0.5)'],
    ['layer 2^32', { layer: 4294967296 }, 'layer must be an integer in [0, 4294967295] (got 4294967296)']
  ];
  for (const [name, bad, message] of cases) {
    it(`throws RangeError for ${name}`, () => {
      const b = new ToolpathIRBuilder();
      expect(() => b.addSegment(seg(0, 0.2, bad))).toThrow(RangeError);
      expect(() => b.addSegment(seg(0, 0.2, bad))).toThrow(`ToolpathIRBuilder: ${message}`);
    });
  }

  it('accepts every channel at its exact maximum and stores it unwrapped', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg(0, 0.2, { kind: 255, tool: 65535, feature: 255, object: 4294967295, srcByte: 4294967295 }));
    const ir = b.finalize();
    expect(ir.segments.kind[0]).toBe(255);
    expect(ir.segments.tool[0]).toBe(65535);
    expect(ir.segments.feature[0]).toBe(255);
    expect(ir.segments.object[0]).toBe(4294967295);
    expect(ir.segments.srcByte[0]).toBe(4294967295);
    expect(ir.tools).toEqual([{ id: 65535 }]);
  });

  it('accepts 0 on every channel', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg(0, 0.2, { kind: 0, tool: 0, feature: 0, object: 0, srcByte: 0 }));
    expect(b.finalize().segments.count).toBe(1);
  });

  it('setTool range-checks the id like the tool channel', () => {
    const b = new ToolpathIRBuilder();
    expect(() => b.setTool({ id: 70000 })).toThrow(
      'ToolpathIRBuilder: tool must be an integer in [0, 65535] (got 70000)'
    );
    b.setTool({ id: 65535 });
    expect(b.finalize().tools).toEqual([{ id: 65535 }]);
  });
});

describe('ToolpathIRBuilder sparse layer indices (sweep G2)', () => {
  it('renumbers sparse layers densely so segments.layer indexes layers[]', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg(0, 0.2, { srcByte: 0 }));
    b.addSegment(seg(5, 0.4, { srcByte: 10 }));
    b.addSegment(seg(9, 0.6, { srcByte: 20 }));
    const ir = b.finalize();
    expect([...ir.segments.layer]).toEqual([0, 1, 2]);
    expect(ir.layers.map((l) => [l.segStart, l.segEnd])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2]
    ]);
    expect(ir.header.warnings).toEqual([
      {
        code: 'layer-indices-densified',
        message: 'segment layer indices were not dense (0..2); renumbered in ascending order',
        severity: 'info'
      }
    ]);
    // Progress now reports an in-range layer index (was 9 against a 3-entry layers[]).
    const m = createProgressMapper(ir);
    expect(m.observe({ v: 1, timestampMs: 0, position: { percent: 1 } }).layerIndex).toBe(2);
  });

  it('a layer list that starts above 0 is renumbered from 0', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg(3, 0.2));
    b.addSegment(seg(4, 0.4));
    const ir = b.finalize();
    expect([...ir.segments.layer]).toEqual([0, 1]);
    expect(ir.header.warnings.map((w) => w.code)).toEqual(['layer-indices-densified']);
  });

  it('dense input is left untouched and emits no warning', () => {
    const b = new ToolpathIRBuilder();
    b.addSegment(seg(0, 0.2));
    b.addSegment(seg(1, 0.4));
    b.addSegment(seg(1, 0.4));
    b.addSegment(seg(2, 0.6));
    const ir = b.finalize();
    expect([...ir.segments.layer]).toEqual([0, 1, 1, 2]);
    expect(ir.layers.map((l) => [l.segStart, l.segEnd])).toEqual([
      [0, 0],
      [1, 2],
      [3, 3]
    ]);
    expect(ir.header.warnings).toEqual([]);
  });

  it('an empty build has no layers and no warning', () => {
    const ir = new ToolpathIRBuilder().finalize();
    expect(ir.layers).toEqual([]);
    expect(ir.header.warnings).toEqual([]);
  });
});

describe('createProgressMapper option validation (sweep G2)', () => {
  const b = new ToolpathIRBuilder();
  b.addSegment(seg(0, 0.2));
  const ir = b.finalize();
  for (const bad of [NaN, Infinity, -Infinity, -1]) {
    it(`staleAfterMs ${bad} throws RangeError`, () => {
      expect(() => createProgressMapper(ir, { staleAfterMs: bad })).toThrow(
        `createProgressMapper: staleAfterMs must be a finite number >= 0 (got ${bad})`
      );
    });
    it(`fileSizeBytes ${bad} throws RangeError`, () => {
      expect(() => createProgressMapper(ir, { fileSizeBytes: bad })).toThrow(RangeError);
      expect(() => createProgressMapper(ir, { fileSizeBytes: bad })).toThrow(
        `createProgressMapper: fileSizeBytes must be a finite number >= 0 (got ${bad})`
      );
    });
  }
  it('staleAfterMs 0 is accepted: stale strictly after the timestamp', () => {
    const m = createProgressMapper(ir, { staleAfterMs: 0 });
    m.observe({ v: 1, timestampMs: 100, position: { percent: 0.5 } });
    expect(m.tick(100).stale).toBe(false);
    expect(m.tick(101).stale).toBe(true);
  });
  it('undefined options keep the 10 s default', () => {
    const m = createProgressMapper(ir, { staleAfterMs: undefined, fileSizeBytes: undefined });
    m.observe({ v: 1, timestampMs: 0, position: { percent: 0.5 } });
    expect(m.tick(10_000).stale).toBe(false);
    expect(m.tick(10_001).stale).toBe(true);
  });
});
