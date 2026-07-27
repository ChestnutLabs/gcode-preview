/**
 * Low-resource Canvas 2D layer view (DD-014 / E8, phase 1, #212).
 *
 * Draws a single layer of a `ToolpathIR` as flat, top-down polylines to a Canvas 2D
 * surface — the memory ceiling is one layer's segments, not the whole model (DD-014 §6/§7).
 * Geometry is read straight from the SoA in the IR's origin-relative frame; per-segment
 * color comes from the shared, renderer-agnostic `@chestnutlabs/gcode-colors` so 2D and 3D
 * never disagree. No `three`, no WebGL.
 *
 * The drawing core ({@link drawLayer}, {@link computeLayerFit}) is pure and takes a minimal
 * {@link CanvasContext2DLike}, so it is fully testable in Node with a recording mock; the
 * {@link LayerView2D} class is a thin lifecycle wrapper over a real `<canvas>`.
 */
import { MoveKind, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createSegmentColorer, type ColorMode, type RGB } from '@chestnutlabs/gcode-colors';

/** The subset of `CanvasRenderingContext2D` the layer view uses (a real context satisfies it). */
export type CanvasContext2DLike = Pick<
  CanvasRenderingContext2D,
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'globalAlpha'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'clearRect'
>;

/** XY extent of a set of segments, in the IR's origin-relative frame. */
export interface LayerBounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** False when the layer has no segments (nothing to fit / draw). */
  hasContent: boolean;
}

/** Maps printer XY (origin-relative) to canvas pixels, with Y flipped (printer up → canvas down). */
export interface LayerFit {
  /** World-units-to-pixels scale. */
  scale: number;
  /** Project a printer XY point to device pixels `[px, py]`. */
  project(x: number, y: number): [number, number];
}

export interface DrawLayerOptions {
  /** Index into `ir.layers`. Out-of-range or absent → nothing drawn (honest no-op). */
  layer: number;
  /** Per-segment color mode (shared with the 3D renderer). Applied to extrusion moves. */
  colorMode: ColorMode;
  /** World→pixel mapping. Usually from {@link computeLayerFit} for the same layer. */
  fit: LayerFit;
  /** Extrusion stroke width in device px (default 1). */
  lineWidth?: number;
  /** Draw travel moves too, in this style. Omitted/false → extrusion only (the default). */
  travel?: TravelStyle | false;
  /** Layer opacity in [0,1] via `globalAlpha` (default 1). Used to dim adjacent "ghost" layers. */
  opacity?: number;
  /**
   * Live-progress "completed cut" (DD-006): the last printed segment index in THIS layer. Extrusion
   * segments at or before it draw at full opacity; those after it draw at {@link upcomingOpacity}
   * (not yet printed). Omit for no progress split. Honest — nothing is hidden, only dimmed.
   */
  progressCutSeg?: number;
  /** Opacity of not-yet-printed extrusion when {@link progressCutSeg} is set (default 0.15). */
  upcomingOpacity?: number;
}

export interface TravelStyle {
  /** CSS color for travel moves (e.g. a muted gray). */
  color: string;
  /** Travel stroke width in device px (default 0.5). */
  lineWidth?: number;
}

export interface DrawLayerResult {
  layer: number;
  layerCount: number;
  extrudeDrawn: number;
  travelDrawn: number;
  /** False when the layer index is out of range or the IR has no layer table. */
  drawn: boolean;
}

/** Clamp a 0..1 float channel and scale to an 8-bit int. */
function chan(v: number): number {
  const c = v < 0 ? 0 : v > 1 ? 1 : v;
  return Math.round(c * 255);
}

/** Convert a float {@link RGB} triple to a CSS `rgb(...)` string for `strokeStyle`. */
export function rgbToCss(rgb: RGB): string {
  return `rgb(${chan(rgb[0])}, ${chan(rgb[1])}, ${chan(rgb[2])})`;
}

/** XY bounds of one layer's segments (both endpoints), in the origin-relative frame. */
export function layerBounds2D(ir: ToolpathIR, layer: number): LayerBounds2D {
  const empty: LayerBounds2D = { minX: 0, minY: 0, maxX: 0, maxY: 0, hasContent: false };
  const l = ir.layers[layer];
  if (!l) return empty;
  const seg = ir.segments;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = l.segStart; i <= l.segEnd && i < seg.count; i++) {
    const xs = [seg.x0[i], seg.x1[i]];
    const ys = [seg.y0[i], seg.y1[i]];
    for (const x of xs) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    for (const y of ys) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (minX > maxX) return empty;
  return { minX, minY, maxX, maxY, hasContent: true };
}

/**
 * Fit `bounds` into a `width`×`height` canvas with uniform scale, centered, `padding` px inset,
 * and the Y axis flipped so higher printer-Y draws higher on screen. Degenerate (zero-span or
 * empty) bounds fall back to scale 1 centered at the canvas middle.
 */
export function computeLayerFit(bounds: LayerBounds2D, width: number, height: number, padding = 8): LayerFit {
  const availW = Math.max(1, width - 2 * padding);
  const availH = Math.max(1, height - 2 * padding);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const scale =
    !bounds.hasContent || (spanX <= 0 && spanY <= 0)
      ? 1
      : Math.min(spanX > 0 ? availW / spanX : Infinity, spanY > 0 ? availH / spanY : Infinity);
  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offsetX = padding + (availW - drawnW) / 2;
  const offsetYTop = padding + (availH - drawnH) / 2;
  const { minX, minY } = bounds;
  return {
    scale,
    project(x: number, y: number): [number, number] {
      const px = offsetX + (x - minX) * scale;
      // Flip Y: the top of the drawn box is offsetYTop; printer-Y grows upward.
      const py = offsetYTop + (drawnH - (y - minY) * scale);
      return [px, py];
    }
  };
}

/**
 * Draw one layer of `ir` to `ctx`. Extrusion moves are colored via {@link DrawLayerOptions.colorMode}
 * (single-sourced with the 3D renderer); travel moves are drawn only when `travel` is given. The
 * caller is responsible for clearing the canvas and for capability-gating the color mode. Returns an
 * honest count; a missing/out-of-range layer draws nothing and reports `drawn: false`.
 */
export function drawLayer(ctx: CanvasContext2DLike, ir: ToolpathIR, opts: DrawLayerOptions): DrawLayerResult {
  const layerCount = ir.layers.length;
  const l = ir.layers[opts.layer];
  const base: DrawLayerResult = {
    layer: opts.layer,
    layerCount,
    extrudeDrawn: 0,
    travelDrawn: 0,
    drawn: false
  };
  if (!l) return base;

  const seg = ir.segments;
  const colorOf = createSegmentColorer(ir, opts.colorMode);
  const extrudeWidth = opts.lineWidth ?? 1;
  const showTravel = opts.travel ? opts.travel : null;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = opts.opacity ?? 1;

  // Travel first (underneath), if requested.
  let travelDrawn = 0;
  if (showTravel) {
    ctx.strokeStyle = showTravel.color;
    ctx.lineWidth = showTravel.lineWidth ?? 0.5;
    for (let i = l.segStart; i <= l.segEnd && i < seg.count; i++) {
      if ((seg.kind[i] & MoveKind.Travel) === 0) continue;
      const [ax, ay] = opts.fit.project(seg.x0[i], seg.y0[i]);
      const [bx, by] = opts.fit.project(seg.x1[i], seg.y1[i]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      travelDrawn++;
    }
  }

  // Extrusion, colored per-segment. With a progress cut, segments after `progressCutSeg` in this
  // layer are the not-yet-printed part — drawn dimmed (never hidden), the 2D "completed cut" (DD-006).
  ctx.lineWidth = extrudeWidth;
  const baseOpacity = opts.opacity ?? 1;
  const upcomingOpacity = baseOpacity * (opts.upcomingOpacity ?? 0.15);
  const cut = opts.progressCutSeg;
  let extrudeDrawn = 0;
  for (let i = l.segStart; i <= l.segEnd && i < seg.count; i++) {
    if ((seg.kind[i] & MoveKind.Extrude) === 0) continue;
    ctx.globalAlpha = cut !== undefined && i > cut ? upcomingOpacity : baseOpacity;
    ctx.strokeStyle = rgbToCss(colorOf(i));
    const [ax, ay] = opts.fit.project(seg.x0[i], seg.y0[i]);
    const [bx, by] = opts.fit.project(seg.x1[i], seg.y1[i]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    extrudeDrawn++;
  }

  ctx.globalAlpha = prevAlpha;
  return { layer: opts.layer, layerCount, extrudeDrawn, travelDrawn, drawn: true };
}

/** XY bounds over ALL of the IR's segments — a stable frame for the layer view (not per-layer). */
export function modelBounds2D(ir: ToolpathIR): LayerBounds2D {
  const seg = ir.segments;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < seg.count; i++) {
    const x0 = seg.x0[i];
    const x1 = seg.x1[i];
    const y0 = seg.y0[i];
    const y1 = seg.y1[i];
    if (x0 < minX) minX = x0;
    if (x1 < minX) minX = x1;
    if (x0 > maxX) maxX = x0;
    if (x1 > maxX) maxX = x1;
    if (y0 < minY) minY = y0;
    if (y1 < minY) minY = y1;
    if (y0 > maxY) maxY = y0;
    if (y1 > maxY) maxY = y1;
  }
  if (minX > maxX) return { minX: 0, minY: 0, maxX: 0, maxY: 0, hasContent: false };
  return { minX, minY, maxX, maxY, hasContent: true };
}

export interface DrawLayersOptions {
  /** Active (fully-drawn) layer index. */
  layer: number;
  /** Number of preceding layers drawn beneath the active one as dimmed "ghosts" (default 1, floor 0). */
  adjacentLayers?: number;
  /** Per-segment color mode for all drawn layers (shared with the 3D renderer). */
  colorMode: ColorMode;
  /** Shared world→pixel mapping — the SAME fit for every layer so they overlay in printer XY. */
  fit: LayerFit;
  /** Extrusion stroke width in device px (default 1). */
  lineWidth?: number;
  /** Draw travel moves too (default hidden). Applied to the active layer only. */
  travel?: TravelStyle | false;
  /** Opacity of each ghost layer in [0,1] (default 0.25). The active layer is always fully opaque. */
  ghostOpacity?: number;
  /** Live-progress cut (DD-006). Applied only when its `layerIndex` is the active layer. */
  progress?: LayerProgress | null;
}

/** The minimal live-progress shape the 2D view needs (a projection of DD-006's `MappedProgress`). */
export interface LayerProgress {
  /** Last printed segment index (global IR index); null when unknown. */
  segIndex: number | null;
  /** Layer currently printing; null when unknown. */
  layerIndex: number | null;
}

export interface DrawLayersResult {
  layer: number;
  layerCount: number;
  /** Ghost layer indices actually drawn (oldest→newest, beneath the active layer). */
  ghostLayers: number[];
  /** Extrusion segments drawn across the active layer + ghosts. */
  extrudeDrawn: number;
  travelDrawn: number;
  drawn: boolean;
}

/**
 * Draw the active layer over its preceding "ghost" layers (DD-014 D2, #213). Ghosts are the
 * `adjacentLayers` layers immediately below the active one, drawn first (underneath) and dimmed to
 * `ghostOpacity`; the active layer is drawn last at full opacity. All layers share ONE `fit`, so
 * they overlay correctly in printer XY. `adjacentLayers: 0` draws the active layer only (the floor).
 */
export function drawLayers(ctx: CanvasContext2DLike, ir: ToolpathIR, opts: DrawLayersOptions): DrawLayersResult {
  const layerCount = ir.layers.length;
  const base: DrawLayersResult = {
    layer: opts.layer,
    layerCount,
    ghostLayers: [],
    extrudeDrawn: 0,
    travelDrawn: 0,
    drawn: false
  };
  if (!ir.layers[opts.layer]) return base;

  const adjacent = Math.max(0, Math.floor(opts.adjacentLayers ?? 1));
  const ghostOpacity = opts.ghostOpacity ?? 0.25;
  const firstGhost = Math.max(0, opts.layer - adjacent);

  const ghostLayers: number[] = [];
  let extrudeDrawn = 0;
  let travelDrawn = 0;

  // Ghosts first (oldest→newest), dimmed, extrusion only — a depth cue, not the focus.
  for (let li = firstGhost; li < opts.layer; li++) {
    const r = drawLayer(ctx, ir, {
      layer: li,
      colorMode: opts.colorMode,
      fit: opts.fit,
      lineWidth: opts.lineWidth,
      opacity: ghostOpacity
    });
    if (r.drawn) {
      ghostLayers.push(li);
      extrudeDrawn += r.extrudeDrawn;
    }
  }

  // Active layer last, full opacity, with travel if requested. Apply the progress cut only when the
  // live-progress layer IS the active layer — otherwise the marker would be misplaced (honest).
  const p = opts.progress;
  const progressCutSeg = p != null && p.segIndex != null && p.layerIndex === opts.layer ? p.segIndex : undefined;
  const active = drawLayer(ctx, ir, {
    layer: opts.layer,
    colorMode: opts.colorMode,
    fit: opts.fit,
    lineWidth: opts.lineWidth,
    travel: opts.travel,
    progressCutSeg
  });
  extrudeDrawn += active.extrudeDrawn;
  travelDrawn += active.travelDrawn;

  return { layer: opts.layer, layerCount, ghostLayers, extrudeDrawn, travelDrawn, drawn: true };
}

export interface LayerView2DOptions {
  /** Initial layer index (default 0). */
  layer?: number;
  /** Initial color mode (default single mid-gray). */
  colorMode?: ColorMode;
  /** Extrusion stroke width in device px (default 1). */
  lineWidth?: number;
  /** Travel style, or false to hide travel (default: hidden). */
  travel?: TravelStyle | false;
  /** Padding inset in device px (default 8). */
  padding?: number;
  /** Preceding "ghost" layers drawn beneath the active one (default 1, floor 0). */
  adjacentLayers?: number;
  /** Ghost-layer opacity in [0,1] (default 0.25). */
  ghostOpacity?: number;
}

const DEFAULT_COLOR_MODE: ColorMode = { mode: 'single', color: [0.55, 0.72, 0.55] };

/**
 * A thin lifecycle wrapper binding a `ToolpathIR` to a `<canvas>`: pick a layer, pick a color
 * mode, `render()`. It owns no WebGL context and holds no per-layer geometry — each `render()`
 * clears and redraws the active layer (plus its dimmed "ghost" layers), so peak memory stays near
 * one layer (DD-014 §6). The view frame is the whole-model XY bounds (cached on `setToolpath`), so
 * scrubbing layers doesn't jump or rescale and ghosts overlay the active layer exactly. Adapter
 * wiring (the `renderer: '2d' | '3d'` prop) arrives in a later E8 phase.
 */
export class LayerView2D {
  private ir: ToolpathIR | null = null;
  private bounds: LayerBounds2D = { minX: 0, minY: 0, maxX: 0, maxY: 0, hasContent: false };
  private layer: number;
  private colorMode: ColorMode;
  private lineWidth: number;
  private travel: TravelStyle | false;
  private padding: number;
  private adjacentLayers: number;
  private ghostOpacity: number;
  private progress: LayerProgress | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: LayerView2DOptions = {}
  ) {
    this.layer = opts.layer ?? 0;
    this.colorMode = opts.colorMode ?? DEFAULT_COLOR_MODE;
    this.lineWidth = opts.lineWidth ?? 1;
    this.travel = opts.travel ?? false;
    this.padding = opts.padding ?? 8;
    this.adjacentLayers = Math.max(0, Math.floor(opts.adjacentLayers ?? 1));
    this.ghostOpacity = opts.ghostOpacity ?? 0.25;
  }

  setToolpath(ir: ToolpathIR | null): void {
    this.ir = ir;
    // Cache the stable whole-model frame once (a scan is O(segments); render() stays layer-bounded).
    this.bounds = ir ? modelBounds2D(ir) : { minX: 0, minY: 0, maxX: 0, maxY: 0, hasContent: false };
    if (ir && this.layer > ir.layers.length - 1) this.layer = Math.max(0, ir.layers.length - 1);
  }

  setLayer(layer: number): void {
    this.layer = layer < 0 ? 0 : layer;
  }

  setColorMode(colorMode: ColorMode): void {
    this.colorMode = colorMode;
  }

  /** Number of preceding ghost layers drawn beneath the active one (clamped to ≥ 0). */
  setAdjacentLayers(n: number): void {
    this.adjacentLayers = Math.max(0, Math.floor(n));
  }

  /** Live-progress cut (DD-006); null clears it. Applied only when on the active layer. */
  setProgress(progress: LayerProgress | null): void {
    this.progress = progress;
  }

  /** Show/hide travel moves on the active layer (`false` hides). */
  setTravel(travel: TravelStyle | false): void {
    this.travel = travel;
  }

  /** Number of layers in the current IR (0 when none / no layer table). */
  get layerCount(): number {
    return this.ir?.layers.length ?? 0;
  }

  /** Clear and redraw the active layer + ghosts. Returns the draw result (drawn:false when empty). */
  render(): DrawLayersResult {
    const ctx = this.canvas.getContext('2d');
    const empty: DrawLayersResult = {
      layer: this.layer,
      layerCount: this.layerCount,
      ghostLayers: [],
      extrudeDrawn: 0,
      travelDrawn: 0,
      drawn: false
    };
    if (!ctx) return empty;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.ir) return empty;
    const fit = computeLayerFit(this.bounds, this.canvas.width, this.canvas.height, this.padding);
    return drawLayers(ctx, this.ir, {
      layer: this.layer,
      adjacentLayers: this.adjacentLayers,
      colorMode: this.colorMode,
      fit,
      lineWidth: this.lineWidth,
      travel: this.travel,
      ghostOpacity: this.ghostOpacity,
      progress: this.progress
    });
  }
}
