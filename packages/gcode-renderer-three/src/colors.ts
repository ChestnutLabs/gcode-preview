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
  | { mode: 'colorChange'; palette: RGB[]; fallback: RGB }
  // Color-by-speed (#177): map each segment's feedrate onto a ramp. Auto-ranged from the IR when
  // `range` is omitted (pass one to keep the scale stable across files). NaN feedrate → fallback.
  // Capability-gated by the caller on `feedrate` (as feature mode is on `featureRoles`).
  | { mode: 'feedrate'; ramp: RGB[]; range?: [number, number]; fallback: RGB }
  // Color-by-object (#178): shade by `seg.object` (1-based; 0 = none → fallback). `only` isolates a
  // single object (others render as fallback). Capability-gated by the caller on `objects`.
  | { mode: 'object'; palette: RGB[]; fallback: RGB; only?: number };

const DEFAULT_FALLBACK: RGB = [0.7, 0.7, 0.7];

/** Min/max of the IR's defined (non-NaN) feedrates — the auto-range for color-by-speed (#177). */
export function feedrateRange(ir: ToolpathIR): [number, number] {
  const f = ir.segments.feedrate;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : [0, 0];
}

/** Sample a color ramp at t∈[0,1] with linear interpolation between stops. */
function rampColor(ramp: RGB[], t: number): RGB {
  if (ramp.length === 0) return DEFAULT_FALLBACK;
  if (ramp.length === 1) return ramp[0];
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const p = clamped * (ramp.length - 1);
  const lo = Math.floor(p);
  const hi = Math.min(lo + 1, ramp.length - 1);
  const frac = p - lo;
  const a = ramp[lo];
  const b = ramp[hi];
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac];
}

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
  // Feedrate auto-range, computed once (pass `range` in the mode to avoid the rescan / stabilize it).
  let fMin = 0;
  let fSpan = 0;
  if (mode.mode === 'feedrate') {
    const [lo, hi] = mode.range ?? feedrateRange(ir);
    fMin = lo;
    fSpan = hi - lo;
  }
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
    } else if (mode.mode === 'feedrate') {
      // NaN feedrate (before the first F) → fallback, never a fabricated speed color (#177).
      const v = seg.feedrate[i];
      rgb = Number.isNaN(v) ? mode.fallback : rampColor(mode.ramp, fSpan > 0 ? (v - fMin) / fSpan : 0);
    } else if (mode.mode === 'object') {
      // Object 0 = none/unknown → fallback; `only` isolates one object, dimming the rest (#178).
      const obj = seg.object[i];
      rgb =
        obj === 0 || (mode.only !== undefined && obj !== mode.only) || mode.palette.length === 0
          ? mode.fallback
          : mode.palette[(obj - 1) % mode.palette.length];
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
