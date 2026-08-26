/**
 * Resolve a `{ mode: 'filament' }` colour request into a concrete colorer mode using the file's OWN filament
 * colours (DD-024 flash fix). These colours live in parse metadata (`metadata.filaments[].color`), which the
 * IR-only colorer cannot see — so the metadata-aware controller resolves them here before the colorer runs,
 * and the first visible pass is already coloured (no neutral-then-recolor). Honesty preserved: no usable
 * filament colours ⇒ neutral, never a fabricated palette.
 */
import type { ColorMode, RGB } from '@chestnutlabs/gcode-renderer-three';
import type { DialectMetadata, ToolpathIR } from '@chestnutlabs/toolpath-core';

/** Neutral fallback for a resolved `filament` colour mode (matches the colorer default). */
export const FILAMENT_FALLBACK: RGB = [0.7, 0.7, 0.7];

/** Parse a `#RRGGBB` (or `#RGB`) hex string to 0..1 RGB, or `null` when not a usable colour. */
export function hexToRgb(hex: string | undefined): RGB | null {
  if (hex === undefined) return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/**
 * Build a tool/slot palette from the parse metadata's own filament colours (`metadata.filaments[].color`),
 * indexed by 0-based `slot`. Filaments without a usable colour leave a gap filled with the fallback so the
 * array stays dense up to the highest declared slot. Empty when the source declared no filament colours.
 */
export function filamentPalette(metadata: DialectMetadata | undefined): RGB[] {
  const filaments = metadata?.filaments;
  if (filaments === undefined || filaments.length === 0) return [];
  let maxSlot = -1;
  for (const f of filaments) if (f.slot > maxSlot) maxSlot = f.slot;
  if (maxSlot < 0) return [];
  const palette: RGB[] = Array.from({ length: maxSlot + 1 }, () => FILAMENT_FALLBACK);
  let any = false;
  for (const f of filaments) {
    const rgb = hexToRgb(f.color);
    if (rgb !== null && f.slot >= 0) {
      palette[f.slot] = rgb;
      any = true;
    }
  }
  return any ? palette : [];
}

/**
 * Resolve a `{ mode: 'filament' }` request into a concrete colorer mode: colour-change files (M600 swaps)
 * shade by swap slot, multi-extruder files by tool — both from the source's `metadata.filaments` palette. No
 * usable filament colours ⇒ honest neutral (`single` fallback). Any other mode passes through unchanged.
 */
export function resolveColorMode(
  mode: ColorMode | undefined,
  metadata: DialectMetadata | undefined,
  ir: ToolpathIR | null
): ColorMode | undefined {
  if (mode === undefined || mode.mode !== 'filament') return mode;
  const fallback = mode.fallback ?? FILAMENT_FALLBACK;
  const palette = filamentPalette(metadata);
  if (palette.length === 0) return { mode: 'single', color: fallback };
  return ir !== null && ir.colorChanges.length > 0
    ? { mode: 'colorChange', palette, fallback }
    : { mode: 'tool', palette, fallback };
}
