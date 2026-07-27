/**
 * Per-segment color model (DD-014 D3): the renderer-agnostic core both renderers share.
 * Every mode degrades unknown channel values to its fallback — never a fabricated color.
 * These tests own the color *semantics*; each renderer separately tests that it maps the
 * returned RGB onto its own surface (vertex buffer / strokeStyle) correctly.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createSegmentColorer, segmentColor, feedrateRange, layerHeightRange, rampColor, type RGB } from '../index.js';

const A: RGB = [1, 0, 0];
const B: RGB = [0, 1, 0];
const F: RGB = [0.5, 0.5, 0.5];

interface SegChannels {
  feedrate?: number;
  tool?: number;
  feature?: number;
  object?: number;
}

/** N segments, each carrying the given optional channels. */
function makeIR(segs: SegChannels[], colorChangeAt: number[] = []): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let s = 0; s < segs.length; s++) {
    b.addSegment({
      x0: s,
      y0: 0,
      z0: 0.2,
      x1: s + 1,
      y1: 0,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: s * 10,
      ...segs[s]
    });
  }
  for (const segIndex of colorChangeAt) {
    b.addColorChange({ x: segIndex, y: 0, z: 0.2, segIndex, srcByte: segIndex * 10, tool: 0 });
  }
  return b.finalize();
}

describe('single / tool / feature', () => {
  it('single is one color for every segment', () => {
    const ir = makeIR([{}, {}]);
    const c = createSegmentColorer(ir, { mode: 'single', color: A });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([1, 0, 0]);
  });

  it('tool indexes the palette; empty palette → fallback', () => {
    const ir = makeIR([{ tool: 0 }, { tool: 1 }]);
    expect(segmentColor(ir, { mode: 'tool', palette: [A, B], fallback: F }, 0)).toEqual([1, 0, 0]);
    expect(segmentColor(ir, { mode: 'tool', palette: [A, B], fallback: F }, 1)).toEqual([0, 1, 0]);
    expect(segmentColor(ir, { mode: 'tool', palette: [], fallback: F }, 0)).toEqual([0.5, 0.5, 0.5]);
  });

  it('feature 0 (unknown) → fallback; 1-based into palette', () => {
    const ir = makeIR([{ feature: 0 }, { feature: 1 }]);
    const c = createSegmentColorer(ir, { mode: 'feature', palette: [A, B], fallback: F });
    expect(c(0)).toEqual([0.5, 0.5, 0.5]); // unknown
    expect(c(1)).toEqual([1, 0, 0]); // feature 1 → palette[0]
  });
});

describe('colorChange (swap slot, #147)', () => {
  it('shades by count of M600s at or before the segment; none → fallback', () => {
    // color change before segment 2 → segments 0,1 = slot 0, segment 2 = slot 1.
    const ir = makeIR([{}, {}, {}], [2]);
    const c = createSegmentColorer(ir, { mode: 'colorChange', palette: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]); // slot 0 → palette[0]
    expect(c(1)).toEqual([1, 0, 0]);
    expect(c(2)).toEqual([0, 1, 0]); // slot 1 → palette[1]
  });

  it('no color changes → fallback', () => {
    const ir = makeIR([{}, {}]);
    expect(segmentColor(ir, { mode: 'colorChange', palette: [A, B], fallback: F }, 0)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('feedrate (#177)', () => {
  it('maps onto the ramp; NaN → fallback, auto-ranged', () => {
    const ir = makeIR([{ feedrate: 1000 }, { feedrate: 1500 }, { feedrate: 2000 }, {}]);
    expect(feedrateRange(ir)).toEqual([1000, 2000]);
    const c = createSegmentColorer(ir, { mode: 'feedrate', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]); // min → ramp start
    expect(c(1)).toEqual([0.5, 0.5, 0]); // mid → interpolated
    expect(c(2)).toEqual([0, 1, 0]); // max → ramp end
    expect(c(3)).toEqual([0.5, 0.5, 0.5]); // NaN → fallback
  });

  it('honors an explicit range (stable scale across files)', () => {
    const ir = makeIR([{ feedrate: 1500 }]);
    const c = createSegmentColorer(ir, { mode: 'feedrate', ramp: [A, B], range: [1000, 2000], fallback: F });
    expect(c(0)).toEqual([0.5, 0.5, 0]); // 1500 within [1000,2000] → midpoint
  });
});

describe('object (#178)', () => {
  it('shades by object index; 0 → fallback', () => {
    const ir = makeIR([{ object: 1 }, { object: 2 }, { object: 0 }]);
    const c = createSegmentColorer(ir, { mode: 'object', palette: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]); // object 1 → palette[0]
    expect(c(1)).toEqual([0, 1, 0]); // object 2 → palette[1]
    expect(c(2)).toEqual([0.5, 0.5, 0.5]); // object 0 (none) → fallback
  });

  it('`only` isolates one object (others → fallback)', () => {
    const ir = makeIR([{ object: 1 }, { object: 2 }]);
    const c = createSegmentColorer(ir, { mode: 'object', palette: [A, B], fallback: F, only: 1 });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('layerHeight (#179)', () => {
  /** One extrude segment per layer, layer i's Z = zs[i] (deriveLayers reads z1). */
  function layeredIR(zs: number[]): ToolpathIR {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    zs.forEach((z, i) =>
      b.addSegment({
        x0: 0,
        y0: 0,
        z0: z,
        x1: 1,
        y1: 0,
        z1: z,
        e: 1,
        kind: MoveKind.Extrude,
        layer: i,
        srcByte: i * 10
      })
    );
    return b.finalize();
  }

  it('auto-ranges per-layer heights (Z-deltas) and maps each segment onto the ramp', () => {
    // heights: layer0 = 0.2 (from bed), layer1 = 0.5-0.2 = 0.3, layer2 = 0.6-0.5 = 0.1 → range [0.1, 0.3].
    const ir = layeredIR([0.2, 0.5, 0.6]);
    const [lo, hi] = layerHeightRange(ir);
    expect(lo).toBeCloseTo(0.1, 5);
    expect(hi).toBeCloseTo(0.3, 5);

    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], fallback: F });
    // layer2 (thinnest, 0.1) → ramp start A; layer1 (thickest, 0.3) → ramp end B; layer0 (0.2) → midpoint.
    expect(c(2)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0, 1, 0]);
    const mid = c(0);
    expect(mid[0]).toBeCloseTo(0.5, 5);
    expect(mid[1]).toBeCloseTo(0.5, 5);
  });

  it('an explicit range keeps the scale stable across files', () => {
    const ir = layeredIR([0.2, 0.4]); // heights 0.2, 0.2
    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], range: [0, 0.4], fallback: F });
    // both layers are 0.2 → t = 0.5 on [0, 0.4] → midpoint, regardless of this file's own spread.
    expect(c(0)[0]).toBeCloseTo(0.5, 5);
  });

  it('a single layer (zero span) → ramp start, never a divide-by-zero', () => {
    const ir = layeredIR([0.2]);
    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
  });
});

describe('rampColor', () => {
  it('clamps t and handles degenerate ramps', () => {
    expect(rampColor([A, B], -1)).toEqual([1, 0, 0]);
    expect(rampColor([A, B], 2)).toEqual([0, 1, 0]);
    expect(rampColor([A], 0.5)).toEqual([1, 0, 0]);
  });
});
