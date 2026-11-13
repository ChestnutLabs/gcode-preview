/**
 * Gap-fill from a second-pass mutation sweep: palette wraparound, empty / one-entry palettes in every
 * palette mode, range-validation boundaries, the Extrude/Travel precedence of moveKind, and power mode
 * without its channel. Every expected value is a literal.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { checkColorMode, createSegmentColorer, type ColorMode, type RGB } from '../index.js';

const R: RGB = [1, 0, 0];
const G: RGB = [0, 1, 0];
const Bl: RGB = [0, 0, 1];
const FB: RGB = [0.5, 0.5, 0.5];
const DEFAULT: RGB = [0.7, 0.7, 0.7];

/** `n` extrude segments in layer 0; `set` may poke the channels before the IR is used. */
function ir(n: number, set?: (i: ToolpathIR) => void): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let i = 0; i < n; i++) {
    b.addSegment({
      x0: i,
      y0: 0,
      z0: 0.2,
      x1: i + 1,
      y1: 0,
      z1: 0.2,
      e: 1,
      feedrate: 1000 + i,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: i * 10
    });
  }
  const out = b.finalize();
  set?.(out);
  return out;
}

describe('palette wraparound', () => {
  it('feature mode wraps feature roles over a short palette (feature 1 → palette[0])', () => {
    const x = ir(4, (v) => v.segments.feature.set([1, 2, 3, 4]));
    const c = createSegmentColorer(x, { mode: 'feature', palette: [R, G], fallback: FB });
    expect([c(0), c(1), c(2), c(3)]).toEqual([R, G, R, G]);
  });

  it('object mode wraps object ids over a short palette (object 1 → palette[0])', () => {
    const x = ir(4, (v) => v.segments.object.set([1, 2, 3, 4]));
    const c = createSegmentColorer(x, { mode: 'object', palette: [R, G], fallback: FB });
    expect([c(0), c(1), c(2), c(3)]).toEqual([R, G, R, G]);
  });

  it('tool mode wraps tool indexes over a short palette', () => {
    const x = ir(3, (v) => v.segments.tool.set([0, 1, 2]));
    const c = createSegmentColorer(x, { mode: 'tool', palette: [R, G], fallback: FB });
    expect([c(0), c(1), c(2)]).toEqual([R, G, R]);
  });

  it('colorChange mode wraps swap slots over a short palette', () => {
    const x = ir(4, (v) => {
      v.colorChanges.push({ segIndex: 1 }, { segIndex: 2 }, { segIndex: 3 } as never);
    });
    const c = createSegmentColorer(x, { mode: 'colorChange', palette: [R, G], fallback: FB });
    // slots: seg0→0, seg1→1, seg2→2, seg3→3
    expect([c(0), c(1), c(2), c(3)]).toEqual([R, G, R, G]);
  });
});

describe('empty and one-entry palettes, every palette mode', () => {
  const withChannels = (v: ToolpathIR): void => {
    v.segments.tool.set([1, 1]);
    v.segments.feature.set([2, 2]);
    v.segments.object.set([3, 3]);
    v.colorChanges.push({ segIndex: 0 } as never);
  };
  const modes = (palette: RGB[]): [string, ColorMode, RGB][] => [
    ['tool', { mode: 'tool', palette, fallback: FB }, FB],
    ['feature', { mode: 'feature', palette, fallback: FB }, FB],
    ['colorChange', { mode: 'colorChange', palette, fallback: FB }, FB],
    ['object', { mode: 'object', palette, fallback: FB }, FB]
  ];

  it.each(modes([]))('%s: an empty palette yields the fallback for every segment', (_n, mode, fb) => {
    const c = createSegmentColorer(ir(2, withChannels), mode);
    expect(c(0)).toEqual(fb);
    expect(c(1)).toEqual(fb);
  });

  it.each(modes([Bl]))('%s: a one-entry palette yields that entry for every known segment', (_n, mode) => {
    const c = createSegmentColorer(ir(2, withChannels), mode);
    expect(c(0)).toEqual(Bl);
    expect(c(1)).toEqual(Bl);
  });

  it('tool mode: empty palette with no fallback → the neutral default (0.7 grey)', () => {
    const c = createSegmentColorer(ir(1), { mode: 'tool', palette: [] });
    expect(c(0)).toEqual(DEFAULT);
  });

  it('tool mode: a one-entry palette with no fallback still paints palette[0], not the default', () => {
    const c = createSegmentColorer(ir(1), { mode: 'tool', palette: [Bl] });
    expect(c(0)).toEqual(Bl);
  });
});

describe('moveKind precedence', () => {
  it('a segment carrying both Extrude and Travel bits is productive (cut colour), per the mode comment', () => {
    const x = ir(1, (v) => {
      v.segments.kind[0] = MoveKind.Extrude | MoveKind.Travel;
    });
    const c = createSegmentColorer(x, { mode: 'moveKind', cut: R, travel: G, fallback: FB });
    expect(c(0)).toEqual(R);
  });

  it('a Cut|Travel segment is also productive', () => {
    const x = ir(1, (v) => {
      v.segments.kind[0] = MoveKind.Cut | MoveKind.Travel;
    });
    const c = createSegmentColorer(x, { mode: 'moveKind', cut: R, travel: G, fallback: FB });
    expect(c(0)).toEqual(R);
  });
});

describe('power mode without its channel', () => {
  it('no toolPower channel → fallback, even though a feedrate channel exists', () => {
    const x = ir(2); // feedrate 1000, 1001; no modal.toolPower
    const c = createSegmentColorer(x, { mode: 'power', ramp: [R, G], fallback: FB });
    expect(c(0)).toEqual(FB);
    expect(c(1)).toEqual(FB);
  });
});

describe('null means unset (same as omitted)', () => {
  it('tool mode: `fallback: null` paints exactly like an omitted fallback — the 0.7 default', () => {
    const x = ir(2, (v) => v.segments.tool.set([0, 0]));
    const omitted = createSegmentColorer(x, { mode: 'tool', palette: [] });
    const nulled = createSegmentColorer(x, { mode: 'tool', palette: [], fallback: null } as unknown as ColorMode);
    expect(omitted(0)).toEqual([0.7, 0.7, 0.7]);
    expect(nulled(0)).toEqual([0.7, 0.7, 0.7]);
    expect(nulled(1)).toEqual([0.7, 0.7, 0.7]);
  });

  it('filament mode: `fallback: null` paints exactly like an omitted fallback — the 0.7 default', () => {
    const omitted = createSegmentColorer(ir(1), { mode: 'filament' });
    const nulled = createSegmentColorer(ir(1), { mode: 'filament', fallback: null } as unknown as ColorMode);
    expect(omitted(0)).toEqual([0.7, 0.7, 0.7]);
    expect(nulled(0)).toEqual([0.7, 0.7, 0.7]);
  });

  it.each(['feedrate', 'layerHeight', 'power'] as const)(
    '%s mode: `range: null` is auto-range, same as omitted (no TypeError)',
    (m) => {
      const x = ir(2, (v) => {
        (v.segments as { modal?: Record<string, Float32Array> }).modal = { toolPower: Float32Array.from([10, 30]) };
      });
      const base = { mode: m, ramp: [R, G], fallback: FB } as const;
      const nulled = { ...base, range: null } as unknown as ColorMode;
      expect(() => {
        checkColorMode(nulled);
      }).not.toThrow();
      const a = createSegmentColorer(x, base);
      const b = createSegmentColorer(x, nulled);
      expect([b(0), b(1)]).toEqual([a(0), a(1)]);
    }
  );

  it('a required fallback (feature mode) still throws for null', () => {
    expect(() => {
      checkColorMode({ mode: 'feature', palette: [R], fallback: null } as unknown as ColorMode);
    }).toThrow(new RangeError('feature color mode fallback must be [r, g, b] of three finite numbers, got null'));
  });

  it('a bad (non-null) optional fallback still throws RangeError', () => {
    expect(() => {
      checkColorMode({ mode: 'tool', palette: [R], fallback: [NaN, 0, 0] } as unknown as ColorMode);
    }).toThrow(RangeError);
  });
});

describe('explicit range validation boundaries', () => {
  const ranged = (range: [number, number]): ColorMode => ({ mode: 'feedrate', ramp: [R, G], range, fallback: FB });

  it('[0, 0] is a valid point range', () => {
    expect(() => {
      checkColorMode(ranged([0, 0]));
    }).not.toThrow();
  });

  it('a range inverted by less than 1 is still rejected', () => {
    expect(() => {
      checkColorMode(ranged([5, 4.5]));
    }).toThrow(RangeError);
  });

  it('object `only` above 2**53 is rejected (not a safe integer)', () => {
    expect(() => {
      checkColorMode({ mode: 'object', palette: [R], fallback: FB, only: 2 ** 53 });
    }).toThrow(RangeError);
  });
});
