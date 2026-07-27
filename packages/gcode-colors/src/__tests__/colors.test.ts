/**
 * Per-segment color model (DD-014 D3): the renderer-agnostic core both renderers share.
 * Every mode degrades unknown channel values to its fallback — never a fabricated color.
 * These tests own the color *semantics*; each renderer separately tests that it maps the
 * returned RGB onto its own surface (vertex buffer / strokeStyle) correctly.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createSegmentColorer, segmentColor, feedrateRange, rampColor, type RGB } from '../index.js';

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

describe('rampColor', () => {
  it('clamps t and handles degenerate ramps', () => {
    expect(rampColor([A, B], -1)).toEqual([1, 0, 0]);
    expect(rampColor([A, B], 2)).toEqual([0, 1, 0]);
    expect(rampColor([A], 0.5)).toEqual([1, 0, 0]);
  });
});
