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
  'strokeStyle' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'clearRect'
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

  // Extrusion, colored per-segment.
  ctx.lineWidth = extrudeWidth;
  let extrudeDrawn = 0;
  for (let i = l.segStart; i <= l.segEnd && i < seg.count; i++) {
    if ((seg.kind[i] & MoveKind.Extrude) === 0) continue;
    ctx.strokeStyle = rgbToCss(colorOf(i));
    const [ax, ay] = opts.fit.project(seg.x0[i], seg.y0[i]);
    const [bx, by] = opts.fit.project(seg.x1[i], seg.y1[i]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    extrudeDrawn++;
  }

  return { layer: opts.layer, layerCount, extrudeDrawn, travelDrawn, drawn: true };
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
}

const DEFAULT_COLOR_MODE: ColorMode = { mode: 'single', color: [0.55, 0.72, 0.55] };

/**
 * A thin lifecycle wrapper binding a `ToolpathIR` to a `<canvas>`: pick a layer, pick a color
 * mode, `render()`. It owns no WebGL context and holds no per-layer geometry — each `render()`
 * clears and redraws the active layer, so peak memory stays near one layer (DD-014 §6). Adapter
 * wiring (the `renderer: '2d' | '3d'` prop) and adjacent "ghost" layers arrive in later E8 phases.
 */
export class LayerView2D {
  private ir: ToolpathIR | null = null;
  private layer: number;
  private colorMode: ColorMode;
  private lineWidth: number;
  private travel: TravelStyle | false;
  private padding: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: LayerView2DOptions = {}
  ) {
    this.layer = opts.layer ?? 0;
    this.colorMode = opts.colorMode ?? DEFAULT_COLOR_MODE;
    this.lineWidth = opts.lineWidth ?? 1;
    this.travel = opts.travel ?? false;
    this.padding = opts.padding ?? 8;
  }

  setToolpath(ir: ToolpathIR | null): void {
    this.ir = ir;
    if (ir && this.layer > ir.layers.length - 1) this.layer = Math.max(0, ir.layers.length - 1);
  }

  setLayer(layer: number): void {
    this.layer = layer < 0 ? 0 : layer;
  }

  setColorMode(colorMode: ColorMode): void {
    this.colorMode = colorMode;
  }

  /** Number of layers in the current IR (0 when none / no layer table). */
  get layerCount(): number {
    return this.ir?.layers.length ?? 0;
  }

  /** Clear and redraw the active layer. Returns the draw result (drawn:false when nothing to show). */
  render(): DrawLayerResult {
    const ctx = this.canvas.getContext('2d');
    const empty: DrawLayerResult = {
      layer: this.layer,
      layerCount: this.layerCount,
      extrudeDrawn: 0,
      travelDrawn: 0,
      drawn: false
    };
    if (!ctx) return empty;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.ir) return empty;
    const fit = computeLayerFit(
      layerBounds2D(this.ir, this.layer),
      this.canvas.width,
      this.canvas.height,
      this.padding
    );
    return drawLayer(ctx, this.ir, {
      layer: this.layer,
      colorMode: this.colorMode,
      fit,
      lineWidth: this.lineWidth,
      travel: this.travel
    });
  }
}
