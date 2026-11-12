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
function hexToRgb(hex: string | undefined): RGB | null {
  if (hex === undefined) return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/**
 * Highest filament slot count read from file metadata. Matches the 64-slot cap every producer applies
 * (the dialect sink, the `.gcode.3mf` reader, the Orca/Bambu header reader).
 */
const MAX_FILAMENT_SLOTS = 64;

/** A slot from file metadata that can index the palette: an integer in `[0, MAX_FILAMENT_SLOTS)`. */
function usableSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < MAX_FILAMENT_SLOTS;
}

/**
 * Build a tool/slot palette from the parse metadata's own filament colours (`metadata.filaments[].color`),
 * indexed by 0-based `slot`. Filaments without a usable colour leave a gap filled with the fallback so the
 * array stays dense up to the highest usable slot. Metadata is untrusted file data: a slot that is not an
 * integer in `[0, 64)` is dropped (that filament is neutral), never thrown on or used to size the palette.
 * Empty when the source declared no usable filament colour. Gaps use `fallback` (default the neutral grey).
 */
export function filamentPalette(metadata: DialectMetadata | undefined, fallback: RGB = FILAMENT_FALLBACK): RGB[] {
  const filaments = metadata?.filaments;
  if (filaments === undefined) return [];
  // Dense up to the highest usable slot, coloured or not: `tool` mode indexes `palette[tool % length]`, so
  // a short palette would wrap an uncoloured high tool onto another filament's colour.
  let maxSlot = -1;
  for (const f of filaments) if (usableSlot(f.slot) && f.slot > maxSlot) maxSlot = f.slot;
  const palette: RGB[] = Array.from({ length: maxSlot + 1 }, () => fallback);
  let any = false;
  for (const f of filaments) {
    const rgb = usableSlot(f.slot) ? hexToRgb(f.color) : null;
    if (rgb !== null) {
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
 *
 * The palette is padded with the fallback to cover every slot the IR can reach (each tool id, or each swap
 * slot `0..colorChanges.length`). The colorer cycles a short palette (`palette[i % length]`), so without the
 * padding a tool or swap the file declared no colour for would borrow another filament's colour.
 */
export function resolveColorMode(
  mode: ColorMode | undefined,
  metadata: DialectMetadata | undefined,
  ir: ToolpathIR | null
): ColorMode | undefined {
  if (mode === undefined || mode.mode !== 'filament') return mode;
  const fallback = mode.fallback ?? FILAMENT_FALLBACK;
  const palette = filamentPalette(metadata, fallback);
  if (palette.length === 0) return { mode: 'single', color: fallback };
  if (ir === null) return { mode: 'tool', palette, fallback };
  const byColorChange = ir.colorChanges.length > 0;
  let slots = byColorChange ? ir.colorChanges.length + 1 : 0;
  if (!byColorChange) for (const t of ir.tools) if (t.id + 1 > slots) slots = t.id + 1;
  while (palette.length < slots) palette.push(fallback);
  return byColorChange ? { mode: 'colorChange', palette, fallback } : { mode: 'tool', palette, fallback };
}
