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
  checkColorMode,
  rampColor,
  segmentColor,
  toolPowerRange,
  type ColorMode,
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

  it('an Infinity value on an explicit finite range clamps to the ramp end', () => {
    const c = createSegmentColorer(makeIR([{ feedrate: HUGE }, { feedrate: 600 }]), {
      mode: 'feedrate',
      ramp: [A, B],
      range: [600, 1200],
      fallback: F
    });
    expect(c(0)).toEqual([0, 1, 0]);
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
    // A hand-built (hostile) IR: two layer entries, but segment 1 claims layer 2, which has no height
    // slot. The builder can't produce this any more (it densifies sparse indices), so write the channel.
    const ir = makeIR([
      { layer: 0, z: 0.2 },
      { layer: 1, z: 0.4 }
    ]);
    ir.segments.layer[1] = 2;
    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], fallback: F });
    expect(c(1)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('consumer options are validated (RangeError), file data never throws', () => {
  const ir = makeIR([
    { feedrate: 1000, toolPower: 10 },
    { feedrate: 2000, toolPower: 20 }
  ]);
  const bad: [number, number][] = [
    [Number.NaN, 10],
    [0, Number.NaN],
    [0, Infinity],
    [-Infinity, 10],
    [-1, 10],
    [0, -1]
  ];

  for (const mode of ['feedrate', 'layerHeight', 'power'] as const) {
    for (const range of bad) {
      it(`${mode} range [${String(range[0])}, ${String(range[1])}] throws a RangeError`, () => {
        const m = { mode, ramp: [A, B], range, fallback: F };
        expect(() => checkColorMode(m)).toThrow(RangeError);
        expect(() => createSegmentColorer(ir, m)).toThrow(`${mode} color range must be two finite numbers >= 0`);
      });
    }
  }

  it('a bad power range throws even when the toolPower channel was not captured', () => {
    expect(() =>
      createSegmentColorer(makeIR([{ feedrate: 1 }]), { mode: 'power', ramp: [A, B], range: [0, -5], fallback: F })
    ).toThrow(RangeError);
  });

  it('an inverted range throws, naming the option, both values, and the reversed-ramp remedy', () => {
    for (const mode of ['feedrate', 'layerHeight', 'power'] as const) {
      expect(() => checkColorMode({ mode, ramp: [A, B], range: [2000, 1000], fallback: F })).toThrow(
        `${mode} color range is inverted: lo 2000 > hi 1000. Pass [lo, hi] in ascending order; ` +
          'for a reversed scale, reverse the ramp instead'
      );
    }
  });

  it('a point range [v, v] and a zero lower bound are valid', () => {
    const c = createSegmentColorer(ir, { mode: 'feedrate', ramp: [A, B], range: [1500, 1500], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([1, 0, 0]);
    const z = createSegmentColorer(ir, { mode: 'power', ramp: [A, B], range: [0, 20], fallback: F });
    expect(z(0)).toEqual([0.5, 0.5, 0]);
  });

  for (const only of [0, -1, 1.5, Number.NaN, Infinity]) {
    it(`object only=${String(only)} throws a RangeError`, () => {
      const m = { mode: 'object', palette: [A, B], fallback: F, only } as const;
      expect(() => checkColorMode(m)).toThrow(RangeError);
      expect(() => createSegmentColorer(ir, m)).toThrow("object color mode 'only' must be a 1-based integer");
    });
  }

  it('object only=1 is valid; modes without range/only never throw', () => {
    expect(() => checkColorMode({ mode: 'object', palette: [A], fallback: F, only: 1 })).not.toThrow();
    expect(() => checkColorMode({ mode: 'feedrate', ramp: [A], fallback: F })).not.toThrow();
    expect(() => checkColorMode({ mode: 'single', color: A })).not.toThrow();
  });

  it('segmentColor rejects an index outside [0, count) instead of returning undefined', () => {
    const m = { mode: 'tool', palette: [A, B], fallback: F } as const;
    for (const i of [-1, 2, 0.5, Number.NaN]) {
      expect(() => segmentColor(ir, m, i)).toThrow('segIndex must be an integer in [0, 2)');
    }
    expect(segmentColor(ir, m, 1)).toEqual([1, 0, 0]);
  });
});

describe('hostile negative F / S values', () => {
  it('a negative feedrate is skipped by the auto-range and coloured fallback', () => {
    const ir = makeIR([{ feedrate: 1000 }, { feedrate: 2000 }, { feedrate: -50000 }]);
    expect(feedrateRange(ir)).toEqual([1000, 2000]);
    const c = createSegmentColorer(ir, { mode: 'feedrate', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0, 1, 0]);
    expect(c(2)).toEqual([0.5, 0.5, 0.5]);
  });

  it('a negative tool power is skipped by the auto-range and coloured fallback; 0 is a real power', () => {
    const ir = makeIR([{ toolPower: 0 }, { toolPower: 100 }, { toolPower: -100 }]);
    expect(toolPowerRange(ir)).toEqual([0, 100]);
    const c = createSegmentColorer(ir, { mode: 'power', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0, 1, 0]);
    expect(c(2)).toEqual([0.5, 0.5, 0.5]);
  });

  it('only negative feedrates → [0, 0], every segment fallback', () => {
    const ir = makeIR([{ feedrate: -1 }, { feedrate: -2 }]);
    expect(feedrateRange(ir)).toEqual([0, 0]);
    const c = createSegmentColorer(ir, { mode: 'feedrate', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([0.5, 0.5, 0.5]);
  });

  it('-Infinity (a huge negative F) is skipped like +Infinity', () => {
    expect(feedrateRange(makeIR([{ feedrate: -HUGE }, { feedrate: 700 }]))).toEqual([700, 700]);
  });
});

describe('empty IR and a single layer', () => {
  it('an empty IR: every auto-range is [0, 0] and building any colorer does not throw', () => {
    const ir = makeIR([]);
    expect(feedrateRange(ir)).toEqual([0, 0]);
    expect(toolPowerRange(ir)).toEqual([0, 0]);
    expect(layerHeightRange(ir)).toEqual([0, 0]);
    expect(layerHeights(ir)).toHaveLength(0);
    const modes: ColorMode[] = [
      { mode: 'feedrate', ramp: [A, B], fallback: F },
      { mode: 'layerHeight', ramp: [A, B], fallback: F },
      { mode: 'power', ramp: [A, B], fallback: F },
      { mode: 'colorChange', palette: [A], fallback: F },
      { mode: 'object', palette: [A], fallback: F }
    ];
    for (const m of modes) expect(() => createSegmentColorer(ir, m)).not.toThrow();
    expect(() => segmentColor(ir, { mode: 'single', color: A }, 0)).toThrow(RangeError);
  });

  it('a single layer is a point range: every segment is the ramp start', () => {
    const ir = makeIR([{ z: 0.3 }, { z: 0.3 }]);
    const [lo, hi] = layerHeightRange(ir);
    expect(lo).toBeCloseTo(0.3, 5);
    expect(hi).toBe(lo);
    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([1, 0, 0]);
  });

  it('a layer index with no layer entry is fallback on a zero span too', () => {
    // Hand-built: one layer, but segment 1 claims layer 3. heights[3] is undefined; with a zero span the
    // ramp position would be 0 (the ramp start) without the bounds guard.
    const ir = makeIR([{ z: 0.2 }, { z: 0.2 }]);
    ir.segments.layer[1] = 3;
    const c = createSegmentColorer(ir, { mode: 'layerHeight', ramp: [A, B], fallback: F });
    expect(c(0)).toEqual([1, 0, 0]);
    expect(c(1)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('rampColor NaN and out-of-range t', () => {
  it('NaN, -Infinity and negative t are the start; +Infinity and t > 1 are the end; 3 stops interpolate', () => {
    const C: RGB = [0, 0, 1];
    expect(rampColor([A, B, C], Number.NaN)).toEqual([1, 0, 0]);
    expect(rampColor([A, B, C], -Infinity)).toEqual([1, 0, 0]);
    expect(rampColor([A, B, C], -0.5)).toEqual([1, 0, 0]);
    expect(rampColor([A, B, C], Infinity)).toEqual([0, 0, 1]);
    expect(rampColor([A, B, C], 7)).toEqual([0, 0, 1]);
    expect(rampColor([A, B, C], 0.75)).toEqual([0, 0.5, 0.5]);
    expect(rampColor([A], 0.9)).toEqual([1, 0, 0]);
  });
});
