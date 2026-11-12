/**
 * DD-024 — the `filament` colour mode resolves against the file's own `metadata.filaments` colours, so a
 * consumer needn't re-supply a palette gcode-preview already knows (and the first render is coloured). Honesty:
 * no usable filament colours ⇒ neutral, never fabricated.
 */
import { describe, it, expect } from 'vitest';
import type { DialectMetadata, ToolpathIR } from '@chestnutlabs/toolpath-core';
import { filamentPalette, resolveColorMode } from '../color-resolve.js';

const md = (filaments: DialectMetadata['filaments']): DialectMetadata => ({ filaments }) as DialectMetadata;
const irWith = (colorChanges: number, toolIds: number[] = []): ToolpathIR =>
  ({
    colorChanges: Array.from({ length: colorChanges }, () => ({})),
    tools: toolIds.map((id) => ({ id }))
  }) as unknown as ToolpathIR;
const G: [number, number, number] = [0.7, 0.7, 0.7];

/** Hex parsing (module-private `hexToRgb`) is exercised through `filamentPalette`, its only caller. */
const colorOf = (color: string | undefined) => filamentPalette(md([{ slot: 0, color }]));

describe('filament colour hex parsing (via filamentPalette)', () => {
  it('parses #RRGGBB and #RGB to 0..1', () => {
    expect(colorOf('#FF0000')).toEqual([[1, 0, 0]]);
    expect(colorOf('#00ff00')).toEqual([[0, 1, 0]]);
    expect(colorOf('#fff')).toEqual([[1, 1, 1]]);
    expect(colorOf('#f80')).toEqual([[1, 0.5333333333333333, 0]]);
    expect(colorOf('#336699')).toEqual([[0.2, 0.4, 0.6]]);
  });
  it('accepts a missing # and surrounding whitespace', () => {
    expect(colorOf('0000FF')).toEqual([[0, 0, 1]]);
    expect(colorOf('  #FF0000 ')).toEqual([[1, 0, 0]]);
  });
  it('treats missing / malformed colours as unusable (empty palette)', () => {
    expect(colorOf(undefined)).toEqual([]);
    expect(colorOf('')).toEqual([]);
    expect(colorOf('red')).toEqual([]);
    expect(colorOf('#12')).toEqual([]);
    expect(colorOf('#1234567')).toEqual([]);
    expect(colorOf('#gggggg')).toEqual([]);
    expect(colorOf('#ggg')).toEqual([]);
  });
});

describe('filamentPalette', () => {
  it('builds a dense slot-indexed palette from the file filament colours', () => {
    const p = filamentPalette(
      md([
        { slot: 0, color: '#FF0000' },
        { slot: 1, color: '#00FF00' }
      ])
    );
    expect(p).toEqual([
      [1, 0, 0],
      [0, 1, 0]
    ]);
  });
  it('is empty when no filament carries a usable colour (honest)', () => {
    expect(filamentPalette(undefined)).toEqual([]);
    expect(filamentPalette(md([]))).toEqual([]);
    expect(filamentPalette(md([{ slot: 0 }, { slot: 1, color: 'not-a-colour' }]))).toEqual([]);
  });
});

describe('resolveColorMode (filament)', () => {
  const metadata = md([
    { slot: 0, color: '#112233' },
    { slot: 1, color: '#445566' }
  ]);

  it('multi-extruder file → tool mode with the file palette', () => {
    const resolved = resolveColorMode({ mode: 'filament' }, metadata, irWith(0));
    expect(resolved).toMatchObject({ mode: 'tool' });
    expect((resolved as { palette: number[][] }).palette).toHaveLength(2);
  });

  it('colour-change file (M600 swaps) → colorChange mode with the file palette', () => {
    const resolved = resolveColorMode({ mode: 'filament' }, metadata, irWith(3));
    expect(resolved).toMatchObject({ mode: 'colorChange' });
  });

  it('no usable filament colours → honest neutral single, never a fabricated palette', () => {
    const resolved = resolveColorMode({ mode: 'filament', fallback: [0.5, 0.5, 0.5] }, md([]), irWith(0));
    expect(resolved).toEqual({ mode: 'single', color: [0.5, 0.5, 0.5] });
  });

  it('passes any non-filament mode through unchanged', () => {
    const tool = { mode: 'tool', palette: [[1, 1, 1]], fallback: [0, 0, 0] } as const;
    expect(resolveColorMode(tool, metadata, irWith(0))).toBe(tool);
    expect(resolveColorMode(undefined, metadata, irWith(0))).toBeUndefined();
  });
});

describe('untrusted filament metadata is bounded, never thrown on', () => {
  it('drops a slot that is not an integer in [0, 64): no throw, no huge palette', () => {
    for (const slot of [1.5, -1, 64, 1e9, 2 ** 32, Number.NaN, Infinity]) {
      const p = filamentPalette(
        md([
          { slot: 0, color: '#FF0000' },
          { slot, color: '#00FF00' }
        ])
      );
      expect(p).toEqual([[1, 0, 0]]);
    }
  });

  it('slot 63 is the highest usable slot; gaps below it are the neutral fallback', () => {
    const p = filamentPalette(md([{ slot: 63, color: '#0000FF' }]));
    expect(p).toHaveLength(64);
    expect(p[0]).toEqual(G);
    expect(p[63]).toEqual([0, 0, 1]);
  });

  it('only unusable slots → empty palette (honest neutral)', () => {
    expect(filamentPalette(md([{ slot: 1.5, color: '#00FF00' }]))).toEqual([]);
  });

  it('a declared-but-uncoloured high slot keeps the palette dense to it', () => {
    expect(filamentPalette(md([{ slot: 0, color: '#FF0000' }, { slot: 2 }]))).toEqual([[1, 0, 0], G, G]);
  });

  it('gaps take the consumer fallback when one is given', () => {
    const F: [number, number, number] = [0.1, 0.2, 0.3];
    expect(filamentPalette(md([{ slot: 1, color: '#FF0000' }]), F)).toEqual([F, [1, 0, 0]]);
    const r = resolveColorMode({ mode: 'filament', fallback: F }, md([{ slot: 1, color: '#FF0000' }]), irWith(0));
    expect(r).toEqual({ mode: 'tool', palette: [F, [1, 0, 0]], fallback: F });
  });
});

describe('resolveColorMode pads the palette to every slot the IR reaches', () => {
  const two = md([
    { slot: 0, color: '#FF0000' },
    { slot: 1, color: '#00FF00' }
  ]);

  it('a tool beyond the declared filaments is fallback, not a wrapped filament colour', () => {
    const r = resolveColorMode({ mode: 'filament' }, two, irWith(0, [0, 1, 3])) as { palette: number[][] };
    expect(r.palette).toEqual([[1, 0, 0], [0, 1, 0], G, G]);
  });

  it('a swap slot beyond the declared filaments is fallback (3 swaps → 4 slots)', () => {
    const r = resolveColorMode({ mode: 'filament' }, two, irWith(3, [0])) as { mode: string; palette: number[][] };
    expect(r.mode).toBe('colorChange');
    expect(r.palette).toEqual([[1, 0, 0], [0, 1, 0], G, G]);
  });

  it('never shrinks: tools within the palette leave it as declared', () => {
    const r = resolveColorMode({ mode: 'filament' }, two, irWith(0, [0])) as { palette: number[][] };
    expect(r.palette).toEqual([
      [1, 0, 0],
      [0, 1, 0]
    ]);
    const c = resolveColorMode({ mode: 'filament' }, two, irWith(1, [5])) as { palette: number[][] };
    expect(c.palette).toEqual([
      [1, 0, 0],
      [0, 1, 0]
    ]);
  });

  it('no IR yet → tool mode with the unpadded file palette', () => {
    expect(resolveColorMode({ mode: 'filament' }, two, null)).toEqual({
      mode: 'tool',
      palette: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      fallback: G
    });
  });
});
