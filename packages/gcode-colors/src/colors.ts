/**
 * Renderer-agnostic per-segment color model (DD-014 D3, extracted from
 * `gcode-renderer-three` so the 3D and 2D renderers single-source it).
 *
 * A color is a pure function of the IR's channels (`tool`/`feature`/`object`/
 * `feedrate`/`colorChanges`) and a consumer palette — no `three`, no canvas, no
 * geometry. Each renderer maps the returned {@link RGB} onto its own surface
 * (a vertex-color buffer for WebGL, a `strokeStyle` for Canvas 2D).
 *
 * Honesty is built in: unknown channel values degrade to the mode's `fallback`
 * (or the neutral default), never a fabricated role/speed/object color. Modes
 * that read an optional channel (`feature`, `object`, `feedrate`) must be
 * capability-gated by the caller before use — the IR is told, not shown nonsense.
 */
import { MoveKind, type ToolpathIR } from '@chestnutlabs/toolpath-core';

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
  | { mode: 'object'; palette: RGB[]; fallback: RGB; only?: number }
  // Color-by-layer-height (#179): map each segment's LAYER height (the Z-delta to the previous layer)
  // onto a ramp — the Orca/Bambu view that reveals variable-layer-height prints. Auto-ranged from the
  // IR when `range` is omitted. Derived purely from `ir.layers` Z; capability-gated by the caller on
  // `layers` (a non-planar IR collapses every segment to layer 0 → a single height).
  | { mode: 'layerHeight'; ramp: RGB[]; range?: [number, number]; fallback: RGB }
  // Color-by-tool-power (#189, DD-012 D7): map each segment's modal `toolPower` (laser power / spindle
  // RPM — the S value) onto a ramp. Requires the parse to have captured the `toolPower` modal channel
  // (`ParseOptions.modalChannels`); capability-gated by the caller on `toolPower`. NaN (tool off) or a
  // file parsed without the channel → fallback, never a fabricated power color.
  | { mode: 'power'; ramp: RGB[]; range?: [number, number]; fallback: RGB }
  // Cut-vs-rapid (#189, DD-012 D7): productive moves (Extrude or Cut) vs rapids (Travel) — the CNC/laser
  // read of "where the tool is actually working." Capability-gated on `cutMoves` for non-extrusion files.
  | { mode: 'moveKind'; cut: RGB; travel: RGB; fallback: RGB };

/** Neutral color used when a mode has no palette / the channel value is unknown. */
export const DEFAULT_FALLBACK: RGB = [0.7, 0.7, 0.7];

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

/** Min/max of the IR's captured (non-NaN) tool-power values — the auto-range for color-by-power
 *  (#189). Returns `[0, 0]` when the `toolPower` modal channel was not captured. */
export function toolPowerRange(ir: ToolpathIR): [number, number] {
  const p = ir.segments.modal?.toolPower;
  if (p === undefined) return [0, 0];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < p.length; i++) {
    const v = p[i];
    if (Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : [0, 0];
}

/**
 * Per-layer height (mm): the Z-delta from the previous layer, indexed by layer. Layer 0's height is
 * its absolute Z (its thickness from the bed). Negative deltas (non-monotonic Z, e.g. spiral/vase
 * synthetic layers) clamp to 0 rather than fabricate a negative height. Derived only from `ir.layers`.
 */
export function layerHeights(ir: ToolpathIR): Float32Array {
  const layers = ir.layers;
  const h = new Float32Array(layers.length);
  for (let i = 0; i < layers.length; i++) {
    h[i] = i === 0 ? Math.max(0, layers[0].z) : Math.max(0, layers[i].z - layers[i - 1].z);
  }
  return h;
}

/** Min/max per-layer height — the auto-range for color-by-layer-height (#179). */
export function layerHeightRange(ir: ToolpathIR): [number, number] {
  const h = layerHeights(ir);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < h.length; i++) {
    if (h[i] < min) min = h[i];
    if (h[i] > max) max = h[i];
  }
  return min <= max ? [min, max] : [0, 0];
}

/** Sample a color ramp at t∈[0,1] with linear interpolation between stops. */
export function rampColor(ramp: RGB[], t: number): RGB {
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

/** Per-segment RGB accessor — the loop-friendly form both renderers use. */
export type SegmentColorer = (segIndex: number) => RGB;

/**
 * Build a per-segment color accessor for `ir` under `mode`. Feedrate auto-range (or the
 * explicit `range`) is resolved once here, so the returned function is O(1) per segment.
 * The returned RGB is honest: unknown channel values yield the mode's fallback.
 */
export function createSegmentColorer(ir: ToolpathIR, mode: ColorMode): SegmentColorer {
  const seg = ir.segments;
  if (mode.mode === 'single') {
    const c = mode.color;
    return () => c;
  }
  if (mode.mode === 'tool') {
    const fallback = mode.fallback ?? DEFAULT_FALLBACK;
    return (i) => (mode.palette.length > 0 ? mode.palette[seg.tool[i] % mode.palette.length] : fallback);
  }
  if (mode.mode === 'feature') {
    // Feature 0 = unknown (DD-001): fallback color, never a fabricated role color.
    return (i) => {
      const feature = seg.feature[i];
      return feature === 0 || mode.palette.length === 0
        ? mode.fallback
        : mode.palette[(feature - 1) % mode.palette.length];
    };
  }
  if (mode.mode === 'colorChange') {
    // Shade by swap slot, not by seg.tool — the "reuse by-tool coloring" of DD-009 D2, keyed on the
    // M600 count. Slot 0 = base filament = palette[0]. With no color changes (or no palette) use the
    // neutral fallback, never a fabricated slot color.
    return (i) =>
      ir.colorChanges.length === 0 || mode.palette.length === 0
        ? mode.fallback
        : mode.palette[swapSlotAt(ir.colorChanges, i) % mode.palette.length];
  }
  if (mode.mode === 'feedrate') {
    const [lo, hi] = mode.range ?? feedrateRange(ir);
    const span = hi - lo;
    // NaN feedrate (before the first F) → fallback, never a fabricated speed color (#177).
    return (i) => {
      const v = seg.feedrate[i];
      return Number.isNaN(v) ? mode.fallback : rampColor(mode.ramp, span > 0 ? (v - lo) / span : 0);
    };
  }
  if (mode.mode === 'layerHeight') {
    // Precompute per-layer heights once → O(1) per segment (#179). An out-of-range layer index
    // (shouldn't happen; a hostile IR) → fallback, never a fabricated height color.
    const heights = layerHeights(ir);
    const [lo, hi] = mode.range ?? layerHeightRange(ir);
    const span = hi - lo;
    return (i) => {
      const li = seg.layer[i];
      if (li < 0 || li >= heights.length) return mode.fallback;
      return rampColor(mode.ramp, span > 0 ? (heights[li] - lo) / span : 0);
    };
  }
  if (mode.mode === 'power') {
    const power = seg.modal?.toolPower;
    // The channel wasn't captured (parse didn't request toolPower) → everything is fallback.
    if (power === undefined) {
      const fb = mode.fallback;
      return () => fb;
    }
    const [lo, hi] = mode.range ?? toolPowerRange(ir);
    const span = hi - lo;
    // NaN (tool off / never engaged) → fallback, never a fabricated power color.
    return (i) => {
      const v = power[i];
      return Number.isNaN(v) ? mode.fallback : rampColor(mode.ramp, span > 0 ? (v - lo) / span : 0);
    };
  }
  if (mode.mode === 'moveKind') {
    return (i) => {
      const k = seg.kind[i];
      if ((k & (MoveKind.Extrude | MoveKind.Cut)) !== 0) return mode.cut; // productive move
      if ((k & MoveKind.Travel) !== 0) return mode.travel; // rapid
      return mode.fallback;
    };
  }
  // object mode: object 0 = none/unknown → fallback; `only` isolates one object, dimming the rest (#178).
  return (i) => {
    const obj = seg.object[i];
    return obj === 0 || (mode.only !== undefined && obj !== mode.only) || mode.palette.length === 0
      ? mode.fallback
      : mode.palette[(obj - 1) % mode.palette.length];
  };
}

/**
 * The color of a single segment under `mode`. Convenience over {@link createSegmentColorer}
 * for one-off lookups; for a loop, build a colorer once (feedrate auto-range is otherwise
 * rescanned per call).
 */
export function segmentColor(ir: ToolpathIR, mode: ColorMode, segIndex: number): RGB {
  return createSegmentColorer(ir, mode)(segIndex);
}
