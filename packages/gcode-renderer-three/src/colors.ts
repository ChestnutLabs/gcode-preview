/**
 * Per-vertex color building (DD-004 §4.6, phase 1).
 *
 * Colors are computed renderer-side from the IR's `tool`/`feature` channels and a
 * consumer palette; recoloring rewrites this attribute without touching geometry.
 * Feature mode must be capability-gated by the caller (`featureRoles` may be
 * `unavailable` — the UI is told, not silently shown nonsense).
 */
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { GeometryChunk } from './chunks.js';

export type RGB = [number, number, number];

export type ColorMode =
  | { mode: 'single'; color: RGB }
  | { mode: 'tool'; palette: RGB[]; fallback?: RGB }
  | { mode: 'feature'; palette: RGB[]; fallback: RGB }
  | { mode: 'colorChange'; palette: RGB[]; fallback: RGB };

const DEFAULT_FALLBACK: RGB = [0.7, 0.7, 0.7];

/**
 * Swap slot at a segment index (DD-009 D2, #147): the count of M600 color changes at
 * or before it. `colorChanges` is ascending by `segIndex` (source order), so this is a
 * binary upper-bound — decimation-safe (slots are keyed on the original segment index).
 */
function swapSlotAt(colorChanges: readonly { segIndex: number }[], segIndex: number): number {
  let lo = 0;
  let hi = colorChanges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (colorChanges[mid].segIndex <= segIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Build the interleaved color attribute for a chunk: 6 floats per segment (both vertices). */
export function buildChunkColors(ir: ToolpathIR, chunk: GeometryChunk, mode: ColorMode): Float32Array {
  const colors = new Float32Array(chunk.count * 6);
  const seg = ir.segments;
  for (let k = 0; k < chunk.count; k++) {
    const i = chunk.segIndices[k];
    let rgb: RGB;
    if (mode.mode === 'single') {
      rgb = mode.color;
    } else if (mode.mode === 'tool') {
      const tool = seg.tool[i];
      rgb = mode.palette.length > 0 ? mode.palette[tool % mode.palette.length] : (mode.fallback ?? DEFAULT_FALLBACK);
    } else if (mode.mode === 'colorChange') {
      // Shade by swap slot, not by seg.tool — the "reuse by-tool coloring" of DD-009
      // D2, keyed on the M600 count. Slot 0 = base filament = palette[0]. With no color
      // changes (or no palette) use the neutral fallback, never a fabricated slot color.
      rgb =
        ir.colorChanges.length === 0 || mode.palette.length === 0
          ? mode.fallback
          : mode.palette[swapSlotAt(ir.colorChanges, i) % mode.palette.length];
    } else {
      const feature = seg.feature[i];
      // Feature 0 = unknown (DD-001): fallback color, never a fabricated role color.
      rgb = feature === 0 ? mode.fallback : mode.palette[(feature - 1) % mode.palette.length];
    }
    const o = k * 6;
    colors[o] = rgb[0];
    colors[o + 1] = rgb[1];
    colors[o + 2] = rgb[2];
    colors[o + 3] = rgb[0];
    colors[o + 4] = rgb[1];
    colors[o + 5] = rgb[2];
  }
  return colors;
}
