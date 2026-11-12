// @vitest-environment happy-dom
/**
 * Option + untrusted-IR guards for the tube / budget / chunking path (renderer-three sweep).
 * Consumer options throw a RangeError naming the option and its range (never clamped); untrusted IR layer
 * ranges are bounded by construction. Every throw fires BEFORE any loop runs, and the loop guard is proven
 * with an access-counting `kind` array that aborts a runaway walk after 1000 reads — so a regression fails
 * fast instead of spinning for minutes.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, buildChunks, buildTubeChunk, type GLRendererLike } from '../index.js';
import { checkBudgetOptions, checkTubeOptions, tubeRadialForBudget } from '../tubes.js';

function makeRenderer(extra: Record<string, unknown>) {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  return new ToolpathRenderer({
    canvas,
    quality: 'lines',
    createRenderer: () => stub,
    scheduleFrame: () => undefined,
    ...extra
  });
}

const RADIAL = 'tube.radialSegments must be a whole number in [3, 64]';

describe('tube options throw a RangeError naming option + range', () => {
  const bad: Array<[string, unknown, string]> = [
    ['radialSegments', Infinity, `${RADIAL} (got Infinity)`],
    ['radialSegments', -Infinity, `${RADIAL} (got -Infinity)`],
    ['radialSegments', NaN, `${RADIAL} (got NaN)`],
    ['radialSegments', 8.5, `${RADIAL} (got 8.5)`],
    ['radialSegments', 2, `${RADIAL} (got 2)`],
    ['radialSegments', 0, `${RADIAL} (got 0)`],
    ['radialSegments', -8, `${RADIAL} (got -8)`],
    ['radialSegments', 65, `${RADIAL} (got 65)`],
    ['lineWidth', 0, 'tube.lineWidth must be a finite number > 0 (got 0)'],
    ['lineWidth', -0.4, 'tube.lineWidth must be a finite number > 0 (got -0.4)'],
    ['lineWidth', NaN, 'tube.lineWidth must be a finite number > 0 (got NaN)'],
    ['lineWidth', Infinity, 'tube.lineWidth must be a finite number > 0 (got Infinity)'],
    ['lineHeight', 0, 'tube.lineHeight must be a finite number > 0 (got 0)'],
    ['lineHeight', Infinity, 'tube.lineHeight must be a finite number > 0 (got Infinity)'],
    ['maxVertices', NaN, 'tube.maxVertices must be a whole number >= 1 (got NaN)'],
    ['maxVertices', 0, 'tube.maxVertices must be a whole number >= 1 (got 0)'],
    ['maxVertices', 1.5, 'tube.maxVertices must be a whole number >= 1 (got 1.5)'],
    ['maxVertices', Infinity, 'tube.maxVertices must be a whole number >= 1 (got Infinity)']
  ];
  it.each(bad)('tube.%s = %s', (key, value, message) => {
    expect(() => checkTubeOptions({ [key]: value })).toThrow(new RangeError(message));
    expect(() => makeRenderer({ tube: { [key]: value } })).toThrow(new RangeError(message));
  });

  it('accepts undefined and the inclusive range ends', () => {
    expect(() => checkTubeOptions(undefined)).not.toThrow();
    expect(() => checkTubeOptions({})).not.toThrow();
    expect(() => checkTubeOptions({ radialSegments: 3 })).not.toThrow();
    expect(() => checkTubeOptions({ radialSegments: 64 })).not.toThrow();
    expect(() => checkTubeOptions({ lineWidth: 0.001, lineHeight: 0.001, maxVertices: 1 })).not.toThrow();
  });

  it('tubeRadialForBudget(…, Infinity) throws instead of looping forever (thrown before the loop)', () => {
    expect(() => tubeRadialForBudget(1000, Infinity)).toThrow(RangeError);
    expect(() => tubeRadialForBudget(1000, 8.5)).toThrow(RangeError);
    expect(() => tubeRadialForBudget(1000, NaN)).toThrow(RangeError);
    expect(tubeRadialForBudget(1000, 8)).toBe(8);
  });

  it('buildTubeChunk rejects a fractional ring instead of emitting a half-vertex geometry', () => {
    const chunk = {
      kind: 'extrude' as const,
      layerStart: 0,
      layerEnd: 0,
      count: 1,
      positions: new Float32Array([0, 0, 0, 1, 0, 0]),
      segIndices: new Uint32Array([0])
    };
    expect(() => buildTubeChunk(chunk, { radialSegments: 2.5 })).toThrow(RangeError);
    expect(() => buildTubeChunk(chunk, { maxVertices: NaN })).toThrow(RangeError);
    expect(buildTubeChunk(chunk, { radialSegments: 3 }).vertexCount).toBe(8); // 2 rings × (3 + 1)
  });
});

const CONC = "geometryConcurrency must be 'auto', 'off' or a whole number >= 1";

describe('budget options throw a RangeError naming option + range', () => {
  const bad: Array<[string, unknown, string]> = [
    ['tubeByteBudget', NaN, 'tubeByteBudget must be a finite number > 0 (got NaN)'],
    ['tubeByteBudget', Infinity, 'tubeByteBudget must be a finite number > 0 (got Infinity)'],
    ['tubeByteBudget', 0, 'tubeByteBudget must be a finite number > 0 (got 0)'],
    ['tubeByteBudget', -1, 'tubeByteBudget must be a finite number > 0 (got -1)'],
    ['geometryMemoryBudgetBytes', NaN, 'geometryMemoryBudgetBytes must be a finite number > 0 (got NaN)'],
    ['geometryMemoryBudgetBytes', Infinity, 'geometryMemoryBudgetBytes must be a finite number > 0 (got Infinity)'],
    ['geometryMemoryBudgetBytes', 0, 'geometryMemoryBudgetBytes must be a finite number > 0 (got 0)'],
    ['geometryConcurrency', NaN, `${CONC} (got NaN)`],
    ['geometryConcurrency', Infinity, `${CONC} (got Infinity)`],
    ['geometryConcurrency', 0, `${CONC} (got 0)`],
    ['geometryConcurrency', 2.5, `${CONC} (got 2.5)`],
    ['geometryConcurrency', -1, `${CONC} (got -1)`],
    ['geometryConcurrency', 'many', `${CONC} (got many)`]
  ];
  it.each(bad)('%s = %s', (key, value, message) => {
    expect(() => checkBudgetOptions({ [key]: value })).toThrow(new RangeError(message));
    expect(() => makeRenderer({ [key]: value })).toThrow(new RangeError(message));
  });

  it('accepts undefined, auto/off, 1 and small positive budgets', () => {
    expect(() => checkBudgetOptions({})).not.toThrow();
    expect(() => checkBudgetOptions({ geometryConcurrency: 'auto' })).not.toThrow();
    expect(() => checkBudgetOptions({ geometryConcurrency: 'off' })).not.toThrow();
    expect(() => checkBudgetOptions({ geometryConcurrency: 1 })).not.toThrow();
    expect(() => checkBudgetOptions({ tubeByteBudget: 1, geometryMemoryBudgetBytes: 1 })).not.toThrow();
    expect(() =>
      makeRenderer({ tubeByteBudget: 1000, geometryMemoryBudgetBytes: 500, geometryConcurrency: 2 })
    ).not.toThrow();
  });
});

describe('buildChunks: untrusted layer ranges are bounded by construction', () => {
  function makeIR(): ToolpathIR {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    for (let i = 0; i < 3; i++) {
      b.addSegment({
        x0: i,
        y0: 0,
        z0: 0.2,
        x1: i + 1,
        y1: 0,
        z1: 0.2,
        e: 1,
        kind: MoveKind.Extrude,
        layer: 0,
        srcByte: i * 10
      });
    }
    return b.finalize();
  }
  /** Same IR, but every indexed `kind[i]` read is counted; a walk past 1000 reads aborts (fast failure). */
  function countingIR(segStart: number, segEnd: number): ToolpathIR {
    const ir = makeIR();
    let reads = 0;
    const kind = new Proxy(ir.segments.kind, {
      get(target, key) {
        if (typeof key === 'string' && /^-?\d+$/.test(key) && ++reads > 1000) {
          throw new Error('RUNAWAY: layer walk exceeded 1000 reads');
        }
        return (target as unknown as Record<string | symbol, unknown>)[key];
      }
    });
    return {
      ...ir,
      segments: { ...ir.segments, kind },
      layers: [{ ...ir.layers[0], segStart, segEnd }]
    } as ToolpathIR;
  }

  it('a hugely negative segStart does not iterate from there (probed: -50M took 2.6 s)', () => {
    const r = buildChunks(countingIR(-2_000_000_000, 2));
    expect(r.totalSegmentsIncluded).toBe(3);
    expect(r.chunks[0].segIndices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('a hugely large segEnd stops at seg.count', () => {
    expect(buildChunks(countingIR(0, 2_000_000_000)).totalSegmentsIncluded).toBe(3);
  });

  it('NaN bounds include nothing and never loop', () => {
    expect(buildChunks(countingIR(NaN, 2)).totalSegmentsIncluded).toBe(0);
    expect(buildChunks(countingIR(0, NaN)).totalSegmentsIncluded).toBe(0);
  });
});

describe('qualityMode is validated (full | adaptive | fast)', () => {
  const msg = (v: string): string => `qualityMode must be 'full', 'adaptive' or 'fast' (got ${v})`;
  it.each([
    ['best', 'best'],
    ['', ''],
    ['FULL', 'FULL'],
    [null, 'null'],
    [5, '5'],
    [NaN, 'NaN']
  ])('rejects %s', (value, shown) => {
    expect(() => checkBudgetOptions({ qualityMode: value as unknown as string })).toThrow(new RangeError(msg(shown)));
    expect(() => makeRenderer({ qualityMode: value })).toThrow(new RangeError(msg(shown)));
  });
  it('accepts undefined and the three policies', () => {
    for (const q of [undefined, 'full', 'adaptive', 'fast']) {
      expect(() => makeRenderer({ qualityMode: q })).not.toThrow();
    }
  });
});
