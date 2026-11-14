/**
 * Mutation-sweep tests for colors.ts: palette wrap-around, negative first layer, one-stop ramps, and the
 * non-array shapes `checkColorMode` rejects.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder } from '@chestnutlabs/toolpath-core';
import { checkColorMode, createSegmentColorer, layerHeights, rampColor, type ColorMode, type RGB } from '../index.js';

const A: RGB = [1, 0, 0];
const B: RGB = [0, 1, 0];
const F: RGB = [0.5, 0.5, 0.5];

function ir(tools: number[], colorChangeAt: number[] = [], z = 0.2) {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  tools.forEach((tool, s) =>
    b.addSegment({
      x0: s,
      y0: 0,
      z0: z,
      x1: s + 1,
      y1: 0,
      z1: z,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: s * 10,
      tool
    })
  );
  for (const segIndex of colorChangeAt) {
    b.addColorChange({ x: segIndex, y: 0, z, segIndex, srcByte: segIndex * 10, tool: 0 });
  }
  return b.finalize();
}

describe('palette wrap-around', () => {
  it('tool mode wraps a tool id past the palette end', () => {
    const c = createSegmentColorer(ir([0, 1, 2, 3]), { mode: 'tool', palette: [A, B], fallback: F });
    expect([c(0), c(1), c(2), c(3)]).toEqual([A, B, A, B]);
  });

  it('colorChange mode wraps a swap slot past the palette end', () => {
    const c = createSegmentColorer(ir([0, 0, 0, 0], [1, 2]), { mode: 'colorChange', palette: [A, B], fallback: F });
    // slots: seg0 → 0, seg1 → 1, seg2 → 2 (wraps to palette[0]), seg3 → 2
    expect([c(0), c(1), c(2), c(3)]).toEqual([A, B, A, A]);
  });
});

describe('layer heights and ramps', () => {
  it('a negative first-layer Z clamps to 0', () => {
    const built = ir([0], [], -0.5);
    const layers = [{ z: -0.5 }] as unknown as typeof built.layers;
    expect(Array.from(layerHeights({ ...built, layers }))).toEqual([0]);
  });

  it('a one-stop ramp returns that colour for any t, including NaN', () => {
    expect(rampColor([A], 0.7)).toEqual([1, 0, 0]);
    expect(rampColor([A], NaN)).toEqual([1, 0, 0]);
  });
});

describe('checkColorMode rejects non-array palettes and colours', () => {
  const msg = (field: string, got: string) =>
    `tool color mode ${field} must be an array of [r, g, b] colours, got ${got}`;

  it('palette null / object without length', () => {
    expect(() => {
      checkColorMode({ mode: 'tool', palette: null } as unknown as ColorMode);
    }).toThrow(new RangeError(msg('palette', 'null')));
    expect(() => {
      checkColorMode({ mode: 'tool', palette: {} } as unknown as ColorMode);
    }).toThrow(new RangeError(msg('palette', '[object Object]')));
  });

  it('a colour that is an object without length, or null', () => {
    expect(() => {
      checkColorMode({ mode: 'single', color: { 0: 1, 1: 1, 2: 1 } } as unknown as ColorMode);
    }).toThrow(
      new RangeError('single color mode color must be [r, g, b] of three finite numbers, got [object Object]')
    );
    expect(() => {
      checkColorMode({ mode: 'tool', palette: [null] } as unknown as ColorMode);
    }).toThrow(new RangeError('tool color mode palette[0] must be [r, g, b] of three finite numbers, got null'));
  });
});
