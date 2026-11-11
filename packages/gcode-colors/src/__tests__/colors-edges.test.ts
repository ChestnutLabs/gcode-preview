/**
 * Edge cases of the color model found by a mutation sweep: auto-range degenerate inputs, ramp
 * degenerate inputs, mode fallbacks, and non-finite channel values. A `G1 … F` word with a 40-digit
 * literal parses to a finite double that overflows the IR's Float32 channel to Infinity; color-by-speed
 * used to throw a TypeError on that segment and collapse every other segment to the ramp start.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import {
  createSegmentColorer,
  feedrateRange,
  layerHeightRange,
  layerHeights,
  rampColor,
  segmentColor,
  toolPowerRange,
  type RGB
} from '../index.js';

const A: RGB = [1, 0, 0];
const B: RGB = [0, 1, 0];
const F: RGB = [0.5, 0.5, 0.5];
/** A 40-digit G-code literal: finite as a double, Infinity once stored in a Float32 channel. */
const HUGE = Number('9'.repeat(40));

/** One extrude segment per entry; `layer`/`z` default to layer 0 at Z 0.2. */
function makeIR(segs: { feedrate?: number; toolPower?: number; layer?: number; z?: number }[]): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  segs.forEach((s, i) =>
    b.addSegment({
      x0: i,
      y0: 0,
      z0: s.z ?? 0.2,
      x1: i + 1,
      y1: 0,
      z1: s.z ?? 0.2,
      e: 1,
      feedrate: s.feedrate,
      kind: MoveKind.Extrude,
      layer: s.layer ?? 0,
      srcByte: i * 10
    })
  );
  const ir = b.finalize();
  if (segs.some((s) => s.toolPower !== undefined)) {
    (ir.segments as { modal?: Record<string, Float32Array> }).modal = {
      toolPower: Float32Array.from(segs, (s) => s.toolPower ?? NaN)
    };
  }
  return ir;
}

describe('auto-range edges', () => {
  it('a single feedrate is a point range, not [0, 0]', () => {
    expect(feedrateRange(makeIR([{ feedrate: 1500 }, { feedrate: 1500 }]))).toEqual([1500, 1500]);
  });

  it('no defined feedrate at all → [0, 0]', () => {
    expect(feedrateRange(makeIR([{}, {}]))).toEqual([0, 0]);
  });

  it('feedrate and tool-power ranges skip Infinity (Float32 overflow) as well as NaN', () => {
    expect(feedrateRange(makeIR([{ feedrate: 1200 }, { feedrate: HUGE }, { feedrate: 2400 }]))).toEqual([1200, 2400]);
    expect(toolPowerRange(makeIR([{ toolPower: 10 }, { toolPower: HUGE }, { toolPower: 90 }]))).toEqual([10, 90]);
  });

  it('a falling Z clamps that layer height to 0; an IR with no layers ranges to [0, 0]', () => {
    const h = layerHeights(
      makeIR([
        { layer: 0, z: 0.4 },
        { layer: 1, z: 0.2 }
      ])
    );
    expect(h[0]).toBeCloseTo(0.4, 5);
    expect(h[1]).toBe(0);
    expect(layerHeightRange(makeIR([]))).toEqual([0, 0]);
  });
});

describe('rampColor edges', () => {
  it('an empty ramp is the neutral default; NaN t is the ramp start, never a throw', () => {
    expect(rampColor([], 0.5)).toEqual([0.7, 0.7, 0.7]);
    expect(rampColor([A, B], Number.NaN)).toEqual([1, 0, 0]);
  });
});

describe('mode fallbacks', () => {
  it('unresolved filament mode honours its fallback, else the neutral default', () => {
    const ir = makeIR([{}]);
    expect(segmentColor(ir, { mode: 'filament', fallback: F }, 0)).toEqual([0.5, 0.5, 0.5]);
    expect(segmentColor(ir, { mode: 'filament' }, 0)).toEqual([0.7, 0.7, 0.7]);
  });

  it('a zero feedrate span maps every segment to the ramp start', () => {
    const c = createSegmentColorer(makeIR([{ feedrate: 1500 }, { feedrate: 1500 }]), {
      mode: 'feedrate',
      ramp: [A, B],
      fallback: F
    });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([1, 0, 0]);
  });

  it('a NaN feedrate is fallback even when the span is zero', () => {
    const c = createSegmentColorer(makeIR([{ feedrate: 1500 }, {}]), { mode: 'feedrate', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0.5, 0.5, 0.5]);
  });

  it('power auto-ranges from the toolPower channel when no range is given', () => {
    const c = createSegmentColorer(makeIR([{ toolPower: 50 }, { toolPower: 200 }]), {
      mode: 'power',
      ramp: [A, B],
      fallback: F
    });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0, 1, 0]);
  });

  it('power honours an explicit range over the data range', () => {
    const c = createSegmentColorer(makeIR([{ toolPower: 100 }, { toolPower: 150 }]), {
      mode: 'power',
      ramp: [A, B],
      range: [0, 200],
      fallback: F
    });
    expect(c(0)).toEqual([0.5, 0.5, 0]);
  });
});

describe('non-finite channel values never throw', () => {
  it('an Infinity feedrate keeps the scale and clamps to the ramp end', () => {
    const c = createSegmentColorer(makeIR([{ feedrate: 1200 }, { feedrate: 2400 }, { feedrate: HUGE }]), {
      mode: 'feedrate',
      ramp: [A, B],
      fallback: F
    });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0, 1, 0]);
    expect(c(2)).toEqual([0, 1, 0]);
  });

  it('an Infinity value on an explicit infinite range has no ramp position → fallback', () => {
    const c = createSegmentColorer(makeIR([{ feedrate: HUGE }, { feedrate: 600 }]), {
      mode: 'feedrate',
      ramp: [A, B],
      range: [0, Infinity],
      fallback: F
    });
    expect(c(0)).toEqual([0.5, 0.5, 0.5]);
    expect(c(1)).toEqual([1, 0, 0]);
  });

  it('an Infinity tool power clamps to the ramp end', () => {
    const c = createSegmentColorer(makeIR([{ toolPower: 0 }, { toolPower: 100 }, { toolPower: HUGE }]), {
      mode: 'power',
      ramp: [A, B],
      fallback: F
    });
    expect(c(1)).toEqual([0, 1, 0]);
    expect(c(2)).toEqual([0, 1, 0]);
  });

  it('a Z beyond Float32 range: finite layers keep their scale, the NaN-height layer is fallback', () => {
    // Layer heights: 0.2, then Infinity (huge − 0.2), then NaN (Infinity − Infinity).
    const ir = makeIR([
      { layer: 0, z: 0.2 },
      { layer: 1, z: HUGE },
      { layer: 2, z: HUGE }
    ]);
    expect(layerHeightRange(ir)).toEqual([layerHeights(ir)[0], layerHeights(ir)[0]]);
    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(2)).toEqual([0.5, 0.5, 0.5]);
  });

  it('a segment whose layer index has no layer entry is fallback', () => {
    // Sparse layer indices (0, 2) → two layer entries; layer index 2 has no height slot.
    const ir = makeIR([
      { layer: 0, z: 0.2 },
      { layer: 2, z: 0.4 }
    ]);
    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], fallback: F });
    expect(c(1)).toEqual([0.5, 0.5, 0.5]);
  });
});
