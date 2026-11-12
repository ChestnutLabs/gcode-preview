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
  // Color-by-the-file's-own-filament-colours: a SEMANTIC request to colour by tool using the source's own
  // filament colours (`metadata.filaments[].color`), so a consumer needn't re-supply a palette the parser
  // already knows. These colours live in parse METADATA, not the IR, so this mode is **resolved by the
  // metadata-aware layer** (the `gcode-preview-core` controller) into a `tool` palette before the colorer
  // sees it. Reaching the colorer unresolved (a direct renderer user with no metadata) is honestly neutral —
  // never a fabricated colour.
  | { mode: 'filament'; fallback?: RGB }
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

/**
 * Min/max of the finite, non-negative values in a channel, or `[0, 0]` when there are none. A value from
 * the file with no place on a speed/power scale is skipped — NaN (no `F`/`S` yet), ±Infinity (a word too
 * large for the Float32 channel), or a negative `F`/`S` — so one hostile value cannot stretch or collapse
 * the whole scale.
 */
function channelRange(values: ArrayLike<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!(v >= 0) || v === Infinity) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? [min, max] : [0, 0];
}

/**
 * Min/max of the IR's finite, non-negative feedrates — the auto-range for color-by-speed (#177). NaN (no
 * `F` yet), ±Infinity (an `F` word too large for the IR's Float32 channel) and negative feedrates (not a
 * speed) are skipped, so one hostile value cannot distort the whole scale.
 */
export function feedrateRange(ir: ToolpathIR): [number, number] {
  return channelRange(ir.segments.feedrate);
}

/** Min/max of the IR's captured finite, non-negative tool-power values — the auto-range for
 *  color-by-power (#189). Values are skipped as in {@link feedrateRange}. Returns `[0, 0]` when the
 *  `toolPower` modal channel was not captured. */
export function toolPowerRange(ir: ToolpathIR): [number, number] {
  const p = ir.segments.modal?.toolPower;
  return p === undefined ? [0, 0] : channelRange(p);
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

/** Min/max finite per-layer height — the auto-range for color-by-layer-height (#179). */
export function layerHeightRange(ir: ToolpathIR): [number, number] {
  return channelRange(layerHeights(ir));
}

/** Sample a color ramp at t∈[0,1] with linear interpolation between stops. `t` is clamped; NaN → the start. */
export function rampColor(ramp: RGB[], t: number): RGB {
  if (ramp.length === 0) return DEFAULT_FALLBACK;
  const clamped = t > 0 ? (t < 1 ? t : 1) : 0;
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

/**
 * Ramp color of `v` on `[lo, lo + span]` (a zero span → the ramp start; values past either end clamp), or
 * `fallback` when the value has no place on the scale: NaN, or negative (a hostile `F`/`S`; layer heights
 * are never negative). `lo` and `span` are finite and non-negative ({@link checkColorMode} / the auto-range), so `t` is never
 * NaN: `v` is a non-negative number here, and `(v - lo) / span` with `span > 0` is finite or +Infinity.
 */
function rampOrFallback(ramp: RGB[], v: number, lo: number, span: number, fallback: RGB): RGB {
  if (!(v >= 0)) return fallback;
  return rampColor(ramp, span > 0 ? (v - lo) / span : 0);
}

/**
 * Validate a consumer {@link ColorMode}, throwing a `RangeError` for an option that has no meaning, rather
 * than silently painting every segment one colour later:
 *
 * - an explicit `range` (feedrate, layerHeight, power) must be two finite numbers `>= 0` — speeds, powers
 *   and layer heights are never negative — in ascending order. For a reversed scale, reverse the `ramp`.
 *   `[v, v]` is a valid point range: every segment is the ramp start;
 * - object mode's `only` must be a 1-based integer object index (`>= 1`);
 * - every colour (`single.color`, each `palette`/`ramp` entry, `cut`/`travel`, and `fallback`) must be an
 *   array-like of at least three finite numbers (extra entries are ignored). `fallback` may be omitted only
 *   in `tool` and `filament` mode. An empty palette or ramp is valid (every segment is the fallback).
 *
 * {@link createSegmentColorer} calls this, so a direct renderer user gets it for free. A renderer that
 * stores a mode before colouring with it should call it first, so a bad mode throws at the call and is
 * never stored.
 */
export function checkColorMode(mode: ColorMode): void {
  checkModeColors(mode);
  if (mode.mode === 'feedrate' || mode.mode === 'layerHeight' || mode.mode === 'power') {
    if (mode.range === undefined) return;
    const [lo, hi] = mode.range;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < 0) {
      throw new RangeError(
        `${mode.mode} color range must be two finite numbers >= 0, got [${String(lo)}, ${String(hi)}]`
      );
    }
    if (lo > hi) {
      throw new RangeError(
        `${mode.mode} color range is inverted: lo ${String(lo)} > hi ${String(hi)}. ` +
          'Pass [lo, hi] in ascending order; for a reversed scale, reverse the ramp instead'
      );
    }
  } else if (mode.mode === 'object') {
    const only = mode.only;
    if (only !== undefined && !(Number.isSafeInteger(only) && only >= 1)) {
      throw new RangeError(`object color mode 'only' must be a 1-based integer object index, got ${String(only)}`);
    }
  }
}

/** Compact rendering of a bad colour for an error message (first four channels of an array-like). */
function describeColor(c: unknown): string {
  if (typeof c === 'object' && c !== null && typeof (c as ArrayLike<unknown>).length === 'number') {
    const a = c as ArrayLike<unknown>;
    const head = Array.prototype.slice.call(a, 0, 4).map(String).join(', ');
    return `[${head}${a.length > 4 ? ', …' : ''}]`;
  }
  return String(c);
}

/**
 * One colour: an array-like (plain array, readonly tuple, `Float32Array`) whose first three entries are
 * finite numbers. Any finite value is accepted (a 0-255 value renders over-bright, which is defined); extra
 * entries (an alpha) are ignored. NaN, ±Infinity, a short array (its missing entry reads `undefined`) or a
 * non-array have no rendering.
 */
function checkColor(mode: string, field: string, c: unknown): void {
  const a = c as ArrayLike<unknown> | null | undefined;
  const ok =
    typeof a === 'object' &&
    a !== null &&
    typeof a.length === 'number' &&
    Number.isFinite(a[0]) &&
    Number.isFinite(a[1]) &&
    Number.isFinite(a[2]);
  if (!ok) {
    throw new RangeError(
      `${mode} color mode ${field} must be [r, g, b] of three finite numbers, got ${describeColor(c)}`
    );
  }
}

function checkColorList(mode: string, field: string, list: unknown): void {
  const a = list as ArrayLike<unknown> | null | undefined;
  if (typeof a !== 'object' || a === null || typeof a.length !== 'number') {
    throw new RangeError(`${mode} color mode ${field} must be an array of [r, g, b] colours, got ${String(list)}`);
  }
  for (let i = 0; i < a.length; i++) checkColor(mode, `${field}[${String(i)}]`, a[i]);
}

/** Validate every colour a mode carries. `tool` and `filament` may omit `fallback`; every other mode needs one. */
function checkModeColors(mode: ColorMode): void {
  const m = mode.mode;
  switch (mode.mode) {
    case 'single':
      checkColor(m, 'color', mode.color);
      return;
    case 'tool':
    case 'feature':
    case 'colorChange':
    case 'object':
      checkColorList(m, 'palette', mode.palette);
      break;
    case 'feedrate':
    case 'layerHeight':
    case 'power':
      checkColorList(m, 'ramp', mode.ramp);
      break;
    case 'moveKind':
      checkColor(m, 'cut', mode.cut);
      checkColor(m, 'travel', mode.travel);
      break;
    case 'filament':
      break;
  }
  if ((mode.mode === 'tool' || mode.mode === 'filament') && mode.fallback === undefined) return;
  checkColor(m, 'fallback', mode.fallback);
}

/** Per-segment RGB accessor — the loop-friendly form both renderers use. */
export type SegmentColorer = (segIndex: number) => RGB;

/**
 * Build a per-segment color accessor for `ir` under `mode`. Feedrate auto-range (or the
 * explicit `range`) is resolved once here, so the returned function is O(1) per segment.
 * The returned RGB is honest: unknown channel values yield the mode's fallback.
 */
export function createSegmentColorer(ir: ToolpathIR, mode: ColorMode): SegmentColorer {
  checkColorMode(mode);
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
  if (mode.mode === 'filament') {
    // Unresolved here: the file's filament colours live in parse METADATA, which the colorer has no access
    // to. The metadata-aware layer (gcode-preview-core) resolves this to a `tool` palette before the colorer
    // runs; if it reaches here it is honestly neutral (never a fabricated colour).
    const fb = mode.fallback ?? DEFAULT_FALLBACK;
    return () => fb;
  }
  if (mode.mode === 'feedrate') {
    const [lo, hi] = mode.range ?? feedrateRange(ir);
    const span = hi - lo;
    // NaN feedrate (before the first F) or a negative F → fallback, never a fabricated speed color (#177).
    return (i) => rampOrFallback(mode.ramp, seg.feedrate[i], lo, span, mode.fallback);
  }
  if (mode.mode === 'layerHeight') {
    // Precompute per-layer heights once → O(1) per segment (#179). A layer index with no layer entry
    // (a hostile or hand-built IR) → fallback, never a fabricated height color: a Float32Array read past
    // its end is `undefined`, which `rampOrFallback` rejects like NaN (`!(undefined >= 0)`).
    const heights = layerHeights(ir);
    const [lo, hi] = mode.range ?? layerHeightRange(ir);
    const span = hi - lo;
    return (i) => rampOrFallback(mode.ramp, heights[seg.layer[i]], lo, span, mode.fallback);
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
    // NaN (tool off / never engaged) or a negative S → fallback, never a fabricated power color.
    return (i) => rampOrFallback(mode.ramp, power[i], lo, span, mode.fallback);
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
  // The hot-path colorer does not bounds-check; this one-off form does, so a bad index is a RangeError
  // rather than an `undefined` color (or a fabricated one) handed to the renderer.
  if (!Number.isInteger(segIndex) || segIndex < 0 || segIndex >= ir.segments.count) {
    throw new RangeError(`segIndex must be an integer in [0, ${ir.segments.count}), got ${String(segIndex)}`);
  }
  return createSegmentColorer(ir, mode)(segIndex);
}
