/**
 * DD-024 — the `filament` colour mode resolves against the file's own `metadata.filaments` colours, so a
 * consumer needn't re-supply a palette gcode-preview already knows (and the first render is coloured). Honesty:
 * no usable filament colours ⇒ neutral, never fabricated.
 */
import { describe, it, expect } from 'vitest';
import type { DialectMetadata, ToolpathIR } from '@chestnutlabs/toolpath-core';
import { filamentPalette, resolveColorMode } from '../color-resolve.js';

const md = (filaments: DialectMetadata['filaments']): DialectMetadata => ({ filaments }) as DialectMetadata;
const irWith = (colorChanges: number): ToolpathIR =>
  ({ colorChanges: Array.from({ length: colorChanges }, () => ({})) }) as unknown as ToolpathIR;

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
