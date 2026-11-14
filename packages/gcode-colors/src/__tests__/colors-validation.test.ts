/**
 * `checkColorMode` colour validation: a colour with no rendering (NaN, ±Infinity, short, not an array) throws a
 * RangeError naming the mode, the field and the index, before anything is stored or painted.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder } from '@chestnutlabs/toolpath-core';
import { checkColorMode, createSegmentColorer, segmentColor, type ColorMode, type RGB } from '../index.js';

const A: RGB = [1, 0, 0];
const B: RGB = [0, 1, 0];
const F: RGB = [0.5, 0.5, 0.5];
const bad = (m: unknown): ColorMode => m as ColorMode;

function oneSegIR() {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  b.addSegment({ x0: 0, y0: 0, z0: 0.2, x1: 1, y1: 0, z1: 0.2, e: 1, kind: MoveKind.Extrude, layer: 0, srcByte: 0 });
  return b.finalize();
}

describe('checkColorMode: colour messages (literal)', () => {
  const cases: [string, unknown, string][] = [
    [
      'single NaN',
      { mode: 'single', color: [NaN, 0, 0] },
      'single color mode color must be [r, g, b] of three finite numbers, got [NaN, 0, 0]'
    ],
    [
      'single Infinity',
      { mode: 'single', color: [0, Infinity, 0] },
      'single color mode color must be [r, g, b] of three finite numbers, got [0, Infinity, 0]'
    ],
    [
      'single -Infinity in the third channel',
      { mode: 'single', color: [0, 0, -Infinity] },
      'single color mode color must be [r, g, b] of three finite numbers, got [0, 0, -Infinity]'
    ],
    [
      'single short',
      { mode: 'single', color: [1, 0] },
      'single color mode color must be [r, g, b] of three finite numbers, got [1, 0]'
    ],
    [
      'single undefined',
      { mode: 'single', color: undefined },
      'single color mode color must be [r, g, b] of three finite numbers, got undefined'
    ],
    [
      'single null',
      { mode: 'single', color: null },
      'single color mode color must be [r, g, b] of three finite numbers, got null'
    ],
    [
      'single string',
      { mode: 'single', color: '#ff0000' },
      'single color mode color must be [r, g, b] of three finite numbers, got #ff0000'
    ],
    [
      'single non-number entry',
      { mode: 'single', color: [0, 'x', 0] },
      'single color mode color must be [r, g, b] of three finite numbers, got [0, x, 0]'
    ],
    [
      'long colour message is truncated',
      { mode: 'single', color: [0, NaN, 0, 1, 1] },
      'single color mode color must be [r, g, b] of three finite numbers, got [0, NaN, 0, 1, …]'
    ],
    [
      'four-entry colour (alpha shape) is shown in full',
      { mode: 'single', color: [NaN, 0, 0, 1] },
      'single color mode color must be [r, g, b] of three finite numbers, got [NaN, 0, 0, 1]'
    ],
    [
      'tool palette index 2',
      { mode: 'tool', palette: [A, B, [0.1, NaN, 0.3]] },
      'tool color mode palette[2] must be [r, g, b] of three finite numbers, got [0.1, NaN, 0.3]'
    ],
    [
      'tool palette undefined',
      { mode: 'tool', palette: undefined },
      'tool color mode palette must be an array of [r, g, b] colours, got undefined'
    ],
    [
      'tool palette hole',
      { mode: 'tool', palette: [A, undefined] },
      'tool color mode palette[1] must be [r, g, b] of three finite numbers, got undefined'
    ],
    [
      'tool fallback present but bad',
      { mode: 'tool', palette: [A], fallback: [0, 0, NaN] },
      'tool color mode fallback must be [r, g, b] of three finite numbers, got [0, 0, NaN]'
    ],
    [
      'feature palette[0]',
      { mode: 'feature', palette: [[NaN, 0, 0]], fallback: F },
      'feature color mode palette[0] must be [r, g, b] of three finite numbers, got [NaN, 0, 0]'
    ],
    [
      'feature fallback missing',
      { mode: 'feature', palette: [A] },
      'feature color mode fallback must be [r, g, b] of three finite numbers, got undefined'
    ],
    [
      'colorChange palette[1]',
      { mode: 'colorChange', palette: [A, [0, 1]], fallback: F },
      'colorChange color mode palette[1] must be [r, g, b] of three finite numbers, got [0, 1]'
    ],
    [
      'colorChange fallback',
      { mode: 'colorChange', palette: [A], fallback: [Infinity, 0, 0] },
      'colorChange color mode fallback must be [r, g, b] of three finite numbers, got [Infinity, 0, 0]'
    ],
    [
      'filament fallback present but bad',
      { mode: 'filament', fallback: [NaN, NaN, NaN] },
      'filament color mode fallback must be [r, g, b] of three finite numbers, got [NaN, NaN, NaN]'
    ],
    [
      'feedrate ramp[1]',
      { mode: 'feedrate', ramp: [A, [0, NaN, 0]], fallback: F },
      'feedrate color mode ramp[1] must be [r, g, b] of three finite numbers, got [0, NaN, 0]'
    ],
    [
      'feedrate fallback',
      { mode: 'feedrate', ramp: [A, B], fallback: [0, 0] },
      'feedrate color mode fallback must be [r, g, b] of three finite numbers, got [0, 0]'
    ],
    [
      'layerHeight ramp not an array',
      { mode: 'layerHeight', ramp: 5, fallback: F },
      'layerHeight color mode ramp must be an array of [r, g, b] colours, got 5'
    ],
    [
      'power ramp[0]',
      { mode: 'power', ramp: [[0, 0, Infinity]], fallback: F },
      'power color mode ramp[0] must be [r, g, b] of three finite numbers, got [0, 0, Infinity]'
    ],
    [
      'object palette[3]',
      { mode: 'object', palette: [A, B, A, [NaN, 0, 0]], fallback: F },
      'object color mode palette[3] must be [r, g, b] of three finite numbers, got [NaN, 0, 0]'
    ],
    [
      'object fallback',
      { mode: 'object', palette: [A], fallback: undefined },
      'object color mode fallback must be [r, g, b] of three finite numbers, got undefined'
    ],
    [
      'moveKind cut',
      { mode: 'moveKind', cut: [NaN, 0, 0], travel: B, fallback: F },
      'moveKind color mode cut must be [r, g, b] of three finite numbers, got [NaN, 0, 0]'
    ],
    [
      'moveKind travel',
      { mode: 'moveKind', cut: A, travel: [0, 0], fallback: F },
      'moveKind color mode travel must be [r, g, b] of three finite numbers, got [0, 0]'
    ],
    [
      'moveKind fallback',
      { mode: 'moveKind', cut: A, travel: B, fallback: [0, NaN, 0] },
      'moveKind color mode fallback must be [r, g, b] of three finite numbers, got [0, NaN, 0]'
    ]
  ];

  it.each(cases)('%s', (_name, mode, message) => {
    expect(() => {
      checkColorMode(bad(mode));
    }).toThrow(new RangeError(message));
    expect(() => {
      checkColorMode(bad(mode));
    }).toThrow(RangeError);
  });

  it('createSegmentColorer and segmentColor reject a bad colour too', () => {
    const ir = oneSegIR();
    const mode = bad({ mode: 'single', color: [NaN, 0, 0] });
    const msg = 'single color mode color must be [r, g, b] of three finite numbers, got [NaN, 0, 0]';
    expect(() => createSegmentColorer(ir, mode)).toThrow(msg);
    expect(() => segmentColor(ir, mode, 0)).toThrow(msg);
  });

  it('a bad colour is reported before a bad range', () => {
    expect(() => {
      checkColorMode(bad({ mode: 'feedrate', ramp: [[NaN, 0, 0]], fallback: F, range: [5, 1] }));
    }).toThrow('feedrate color mode ramp[0] must be');
  });
});

describe('checkColorMode: colours that stay valid', () => {
  it('accepts every mode with ordinary colours', () => {
    const ok: ColorMode[] = [
      { mode: 'single', color: A },
      { mode: 'tool', palette: [A, B] },
      { mode: 'tool', palette: [A], fallback: F },
      { mode: 'feature', palette: [A], fallback: F },
      { mode: 'colorChange', palette: [A], fallback: F },
      { mode: 'filament' },
      { mode: 'filament', fallback: F },
      { mode: 'feedrate', ramp: [A, B], fallback: F },
      { mode: 'layerHeight', ramp: [A, B], fallback: F, range: [0.1, 0.3] },
      { mode: 'power', ramp: [A, B], fallback: F },
      { mode: 'object', palette: [A], fallback: F, only: 2 },
      { mode: 'moveKind', cut: A, travel: B, fallback: F }
    ];
    for (const m of ok)
      expect(() => {
        checkColorMode(m);
      }).not.toThrow();
  });

  it('empty palettes and ramps are valid (every segment is the fallback)', () => {
    expect(() => {
      checkColorMode({ mode: 'tool', palette: [] });
    }).not.toThrow();
    expect(() => {
      checkColorMode({ mode: 'feedrate', ramp: [], fallback: F });
    }).not.toThrow();
  });

  it('accepts array-likes: Float32Array, readonly tuple, 4-element colour; any finite value (0-255 too)', () => {
    const tuple = [0.2, 0.4, 0.6] as const;
    expect(() => {
      checkColorMode(bad({ mode: 'single', color: new Float32Array([0.25, 0.5, 0.75]) }));
    }).not.toThrow();
    expect(() => {
      checkColorMode(bad({ mode: 'single', color: tuple }));
    }).not.toThrow();
    expect(() => {
      checkColorMode(bad({ mode: 'single', color: [0.1, 0.2, 0.3, 1] }));
    }).not.toThrow();
    expect(() => {
      checkColorMode(bad({ mode: 'single', color: [255, 128, -3] }));
    }).not.toThrow();
    expect(() => {
      checkColorMode(bad({ mode: 'tool', palette: [new Float32Array([1, 0, 0])], fallback: new Float32Array(3) }));
    }).not.toThrow();
  });

  it('a 4-element colour still colours with its first three channels', () => {
    const ir = oneSegIR();
    const c = createSegmentColorer(ir, bad({ mode: 'single', color: [0.1, 0.2, 0.3, 0.9] }))(0);
    expect([c[0], c[1], c[2]]).toEqual([0.1, 0.2, 0.3]);
  });
});
