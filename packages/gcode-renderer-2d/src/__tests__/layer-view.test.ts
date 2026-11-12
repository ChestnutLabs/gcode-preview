/**
 * Canvas 2D layer view (DD-014 / E8 phase 1, #212). Verified with a recording mock 2D context —
 * no real canvas needed — so the drawing core is fully testable in Node:
 *  - fit math projects corners with a flipped Y (printer up → canvas down);
 *  - drawLayer emits one polyline per in-layer segment and honors the travel toggle;
 *  - an out-of-range layer is an honest no-op;
 *  - stroke colors match the shared `@chestnutlabs/gcode-colors` colorer (parity with the 3D renderer).
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createSegmentColorer, type ColorMode } from '@chestnutlabs/gcode-colors';
import {
  LayerView2D,
  computeLayerFit,
  describe2DDisclosures,
  drawLayer,
  drawLayers,
  layerBounds2D,
  modelBounds2D,
  rgbToCss,
  type CanvasContext2DLike,
  type LayerBounds2D,
  type LayerFit
} from '../index.js';

interface Stroke {
  style: string;
  from: [number, number];
  to: [number, number];
  width: number;
  alpha: number;
}

/** A minimal recording 2D context: captures each stroked segment with its style/width/alpha. */
class MockCtx {
  strokeStyle: string = '';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  strokes: Stroke[] = [];
  clears = 0;
  private cur: [number, number] = [0, 0];
  private start: [number, number] = [0, 0];
  beginPath(): void {}
  moveTo(x: number, y: number): void {
    this.start = [x, y];
    this.cur = [x, y];
  }
  lineTo(x: number, y: number): void {
    this.cur = [x, y];
  }
  stroke(): void {
    this.strokes.push({
      style: this.strokeStyle,
      from: this.start,
      to: this.cur,
      width: this.lineWidth,
      alpha: this.globalAlpha
    });
  }
  clearRect(): void {
    this.clears++;
  }
  get ctx(): CanvasContext2DLike {
    return this as unknown as CanvasContext2DLike;
  }
}

/**
 * IR of `layers` layers; each layer has `extrudePerLayer` extrusion moves and one travel move.
 * Segments are added in ascending layer order so the derived layer ranges are contiguous.
 * The very first segment's start defines the floating origin (positions are deltas from it).
 */
function makeIR(layers: number, extrudePerLayer: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let layer = 0; layer < layers; layer++) {
    const z = 0.2 * (layer + 1);
    for (let k = 0; k < extrudePerLayer; k++) {
      b.addSegment({
        x0: k,
        y0: layer,
        z0: z,
        x1: k + 1,
        y1: layer,
        z1: z,
        e: 1,
        kind: MoveKind.Extrude,
        layer,
        srcByte: layer * 1000 + k,
        feedrate: 1000 + 100 * k,
        object: 1
      });
    }
    // one travel move per layer
    b.addSegment({
      x0: extrudePerLayer,
      y0: layer,
      z0: z,
      x1: 0,
      y1: layer + 1,
      z1: z,
      e: 0,
      kind: MoveKind.Travel,
      layer,
      srcByte: layer * 1000 + 999
    });
  }
  return b.finalize();
}

describe('computeLayerFit', () => {
  it('projects corners with a flipped Y, centered and inset', () => {
    const bounds: LayerBounds2D = { minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: true };
    const fit = computeLayerFit(bounds, 100, 100, 10);
    expect(fit.scale).toBe(8); // avail 80 / span 10
    expect(fit.project(0, 0)).toEqual([10, 90]); // min → bottom-left
    expect(fit.project(10, 10)).toEqual([90, 10]); // max → top-right (Y flipped)
  });

  it('degenerate (empty / zero-span) bounds → scale 1, no NaN', () => {
    const fit = computeLayerFit({ minX: 0, minY: 0, maxX: 0, maxY: 0, hasContent: false }, 100, 100, 10);
    expect(fit.scale).toBe(1);
    const [px, py] = fit.project(0, 0);
    expect(Number.isFinite(px)).toBe(true);
    expect(Number.isFinite(py)).toBe(true);
  });
});

describe('layerBounds2D', () => {
  it('empty for a missing layer', () => {
    const ir = makeIR(1, 2);
    expect(layerBounds2D(ir, 5).hasContent).toBe(false);
  });
});

describe('drawLayer', () => {
  const single: ColorMode = { mode: 'single', color: [1, 0, 0] };
  const fit = computeLayerFit({ minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: true }, 100, 100, 8);

  it('draws only the requested layer’s extrusion moves by default (travel hidden)', () => {
    const ir = makeIR(3, 4); // 4 extrude + 1 travel per layer
    const m = new MockCtx();
    const res = drawLayer(m.ctx, ir, { layer: 1, colorMode: single, fit });
    expect(res.drawn).toBe(true);
    expect(res.layerCount).toBe(3);
    expect(res.extrudeDrawn).toBe(4);
    expect(res.travelDrawn).toBe(0); // travel hidden by default
    expect(m.strokes).toHaveLength(4);
    expect(m.strokes.every((s) => s.style === 'rgb(255, 0, 0)')).toBe(true);
  });

  it('draws travel too when a travel style is given', () => {
    const ir = makeIR(2, 3);
    const m = new MockCtx();
    const res = drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit, travel: { color: '#888', lineWidth: 0.5 } });
    expect(res.extrudeDrawn).toBe(3);
    expect(res.travelDrawn).toBe(1);
    // travel is stroked first, underneath, in its own style/width
    expect(m.strokes[0]).toMatchObject({ style: '#888', width: 0.5 });
  });

  it('out-of-range layer is an honest no-op', () => {
    const ir = makeIR(2, 2);
    const m = new MockCtx();
    const res = drawLayer(m.ctx, ir, { layer: 9, colorMode: single, fit });
    expect(res.drawn).toBe(false);
    expect(res.extrudeDrawn).toBe(0);
    expect(m.strokes).toHaveLength(0);
  });

  it('stroke colors match the shared colorer (3D/2D parity)', () => {
    const ir = makeIR(1, 3);
    const mode: ColorMode = {
      mode: 'feedrate',
      ramp: [
        [0, 0, 1],
        [1, 0, 0]
      ],
      fallback: [0.5, 0.5, 0.5]
    };
    const colorOf = createSegmentColorer(ir, mode);
    const m = new MockCtx();
    drawLayer(m.ctx, ir, { layer: 0, colorMode: mode, fit });
    // layer 0 extrusion segments are indices 0..2 (travel is index 3)
    expect(m.strokes.map((s) => s.style)).toEqual([rgbToCss(colorOf(0)), rgbToCss(colorOf(1)), rgbToCss(colorOf(2))]);
  });

  it('opacity sets globalAlpha for the layer’s strokes, then restores it', () => {
    const ir = makeIR(1, 2);
    const m = new MockCtx();
    m.globalAlpha = 1;
    drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit, opacity: 0.3 });
    expect(m.strokes.every((s) => s.alpha === 0.3)).toBe(true);
    expect(m.globalAlpha).toBe(1); // restored after the call
  });
});

describe('modelBounds2D', () => {
  it('spans every layer (a stable frame), not just one', () => {
    const ir = makeIR(3, 2); // y grows with layer index in makeIR
    const b = modelBounds2D(ir);
    expect(b.hasContent).toBe(true);
    const l0 = layerBounds2D(ir, 0);
    // The model frame extends past layer 0 in Y (later layers sit higher).
    expect(b.maxY).toBeGreaterThan(l0.maxY);
  });
});

describe('drawLayers (adjacent ghosts, #213)', () => {
  const single: ColorMode = { mode: 'single', color: [1, 0, 0] };
  const fit = computeLayerFit({ minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: true }, 100, 100, 8);

  it('draws N preceding ghosts under the active layer, dimmed; active at full opacity', () => {
    const ir = makeIR(5, 3); // 3 extrude + 1 travel per layer
    const m = new MockCtx();
    const res = drawLayers(m.ctx, ir, { layer: 3, adjacentLayers: 2, colorMode: single, fit, ghostOpacity: 0.25 });
    expect(res.drawn).toBe(true);
    expect(res.ghostLayers).toEqual([1, 2]); // the 2 layers below the active (3), oldest→newest
    expect(res.extrudeDrawn).toBe(9); // 3 layers × 3 extrusion segments
    // 6 ghost strokes at 0.25, then 3 active strokes at 1.0 — active drawn last (on top).
    const alphas = m.strokes.map((s) => s.alpha);
    expect(alphas.slice(0, 6).every((a) => a === 0.25)).toBe(true);
    expect(alphas.slice(6).every((a) => a === 1)).toBe(true);
  });

  it('adjacentLayers: 0 is the floor — active layer only', () => {
    const ir = makeIR(4, 3);
    const m = new MockCtx();
    const res = drawLayers(m.ctx, ir, { layer: 2, adjacentLayers: 0, colorMode: single, fit });
    expect(res.ghostLayers).toEqual([]);
    expect(res.extrudeDrawn).toBe(3);
    expect(m.strokes.every((s) => s.alpha === 1)).toBe(true);
  });

  it('clamps the ghost window at layer 0 (no negative layers)', () => {
    const ir = makeIR(4, 2);
    const m = new MockCtx();
    const res = drawLayers(m.ctx, ir, { layer: 1, adjacentLayers: 5, colorMode: single, fit });
    expect(res.ghostLayers).toEqual([0]); // only layer 0 exists below layer 1
  });

  it('out-of-range active layer is an honest no-op', () => {
    const ir = makeIR(2, 2);
    const m = new MockCtx();
    const res = drawLayers(m.ctx, ir, { layer: 9, adjacentLayers: 1, colorMode: single, fit });
    expect(res.drawn).toBe(false);
    expect(m.strokes).toHaveLength(0);
  });

  it('progress cut dims not-yet-printed extrusion on the active layer (DD-006)', () => {
    const ir = makeIR(1, 4); // extrusion indices 0..3 (travel is 4)
    const m = new MockCtx();
    drawLayers(m.ctx, ir, {
      layer: 0,
      adjacentLayers: 0,
      colorMode: single,
      fit,
      progress: { segIndex: 1, layerIndex: 0 }
    });
    // segs 0,1 printed → full; segs 2,3 upcoming → dimmed (0.15).
    expect(m.strokes.map((s) => s.alpha)).toEqual([1, 1, 0.15, 0.15]);
  });

  it('progress on a different layer does not cut the active layer', () => {
    const ir = makeIR(2, 3);
    const m = new MockCtx();
    drawLayers(m.ctx, ir, {
      layer: 1,
      adjacentLayers: 0,
      colorMode: single,
      fit,
      progress: { segIndex: 0, layerIndex: 0 } // progress is on layer 0, we're viewing layer 1
    });
    expect(m.strokes.every((s) => s.alpha === 1)).toBe(true); // no cut applied
  });
});

describe('describe2DDisclosures (capability honesty, DD-014 §6/§11)', () => {
  const withLayers = (ir: ToolpathIR, conf: 'known' | 'inferred' | 'unavailable'): ToolpathIR => {
    ir.header.capabilities['layers'] = conf;
    return ir;
  };

  it('planar (layers: known) → no disclosures', () => {
    expect(describe2DDisclosures(withLayers(makeIR(2, 2), 'known'))).toEqual([]);
  });

  it('non-planar/CNC (layers: unavailable) → discloses the flat-projection limit', () => {
    const notes = describe2DDisclosures(withLayers(makeIR(1, 3), 'unavailable'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/non-planar|flat|not represented/i);
  });

  it('inferred layers → a softer disclosure', () => {
    const notes = describe2DDisclosures(withLayers(makeIR(2, 2), 'inferred'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/inferred/i);
  });
});

// ---------------------------------------------------------------------------------------------
// Mutation sweep of the existing 2D renderer (2026-11). Every assertion below is a LITERAL value
// worked out by hand, never the module's own constant, so a mutated clause/branch/default fails.
// ---------------------------------------------------------------------------------------------

interface SegSpec {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind?: number;
  layer?: number;
}

/** IR from explicit XY segments in a zero-origin frame (stored coordinates = the given ones). */
function irOf(segs: SegSpec[]): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'test',
    units: 'mm',
    unitsSource: 'known',
    originOffset: { x: 0, y: 0, z: 0 }
  });
  segs.forEach((s, i) => {
    const layer = s.layer ?? 0;
    const z = 0.2 * (layer + 1);
    b.addSegment({
      x0: s.x0,
      y0: s.y0,
      z0: z,
      x1: s.x1,
      y1: s.y1,
      z1: z,
      e: (s.kind ?? MoveKind.Extrude) === MoveKind.Travel ? 0 : 1,
      kind: s.kind ?? MoveKind.Extrude,
      layer,
      srcByte: i
    });
  });
  return b.finalize();
}

/** A fit that just scales, so stroke endpoints are easy to predict. */
const scaleFit: LayerFit = { scale: 1, project: (x, y) => [x * 10, y * 100] };

/** A fake `<canvas>` whose 2D context is the recording mock (or null). */
function fakeCanvas(width: number, height: number, ctx: MockCtx | null): HTMLCanvasElement {
  return { width, height, getContext: () => (ctx ? ctx.ctx : null) } as unknown as HTMLCanvasElement;
}

/** Wrap a typed array so every integer-index read is recorded (to prove loop bounds). */
function recordReads<T extends Float32Array | Uint8Array>(arr: T, reads: number[]): T {
  return new Proxy(arr, {
    get(target, key) {
      if (typeof key === 'string' && /^-?\d+$/.test(key)) reads.push(Number(key));
      const v = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    }
  });
}

/**
 * Wrap an array so it throws after `budget` property reads. A regression that turns a bounded loop
 * into a runaway one then fails fast with a clear error, instead of spinning a synchronous loop that
 * vitest's per-test timeout cannot interrupt (it would hang the run, and CI, until killed).
 */
function readBudget<T extends object>(arr: T, budget: number, label: string): T {
  let reads = 0;
  return new Proxy(arr, {
    get(target, key) {
      if (++reads > budget) throw new Error(`${label}: read budget of ${budget} exceeded (runaway loop)`);
      const v = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    }
  });
}

describe('rgbToCss (sweep)', () => {
  it('clamps each channel to [0,1] and rounds to 8 bits', () => {
    expect(rgbToCss([-0.5, 1.5, 0.5])).toBe('rgb(0, 255, 128)');
  });

  it('keeps channel order r, g, b', () => {
    expect(rgbToCss([0.2, 0.4, 0.6])).toBe('rgb(51, 102, 153)');
  });

  it('a NaN channel becomes 0 — never the invalid CSS "rgb(NaN, …)" a canvas silently ignores', () => {
    expect(rgbToCss([Number.NaN, 1, Number.NaN])).toBe('rgb(0, 255, 0)');
  });
});

describe('layerBounds2D (sweep)', () => {
  it('spans both endpoints of every segment in the layer', () => {
    const ir = irOf([{ x0: 1, y0: 5, x1: 4, y1: -3 }]);
    expect(layerBounds2D(ir, 0)).toEqual({ minX: 1, minY: -3, maxX: 4, maxY: 5, hasContent: true });
  });

  it('a second shape: min/max can come from either endpoint', () => {
    const ir = irOf([{ x0: 7, y0: -2, x1: -6, y1: 9 }]);
    expect(layerBounds2D(ir, 0)).toEqual({ minX: -6, minY: -2, maxX: 7, maxY: 9, hasContent: true });
  });

  it('only the requested layer contributes', () => {
    const ir = irOf([
      { x0: 0, y0: 0, x1: 1, y1: 1, layer: 0 },
      { x0: 50, y0: 50, x1: 60, y1: 70, layer: 1 }
    ]);
    expect(layerBounds2D(ir, 1)).toEqual({ minX: 50, minY: 50, maxX: 60, maxY: 70, hasContent: true });
  });

  it('a layer whose range lies past the segment table is empty, not ±Infinity', () => {
    const ir = irOf([{ x0: 0, y0: 0, x1: 1, y1: 1 }]);
    ir.layers[0] = { z: 0.2, segStart: 5, segEnd: 6 };
    expect(layerBounds2D(ir, 0)).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, hasContent: false });
  });

  it('never reads past segments.count, even when segEnd overshoots it', () => {
    const ir = irOf([
      { x0: 0, y0: 0, x1: 1, y1: 1 },
      { x0: 1, y0: 1, x1: 2, y1: 2 }
    ]);
    ir.layers[0] = { z: 0.2, segStart: 0, segEnd: 1_000_000 };
    const reads: number[] = [];
    ir.segments.x0 = recordReads(ir.segments.x0, reads);
    expect(layerBounds2D(ir, 0)).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 2, hasContent: true });
    expect(Math.max(...reads)).toBe(1);
  });
});

describe('modelBounds2D (sweep)', () => {
  it('min from the end point, max from the start point', () => {
    const ir = irOf([{ x0: 10, y0: 20, x1: -10, y1: -20 }]);
    expect(modelBounds2D(ir)).toEqual({ minX: -10, minY: -20, maxX: 10, maxY: 20, hasContent: true });
  });

  it('min from the start point, max from the end point', () => {
    const ir = irOf([{ x0: -10, y0: -20, x1: 10, y1: 20 }]);
    expect(modelBounds2D(ir)).toEqual({ minX: -10, minY: -20, maxX: 10, maxY: 20, hasContent: true });
  });

  it('includes the last segment', () => {
    const ir = irOf([
      { x0: 0, y0: 0, x1: 1, y1: 1 },
      { x0: 1, y0: 1, x1: 30, y1: 40 }
    ]);
    expect(modelBounds2D(ir)).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 40, hasContent: true });
  });

  it('an IR with no segments is empty, not ±Infinity', () => {
    expect(modelBounds2D(irOf([]))).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, hasContent: false });
  });
});

describe('computeLayerFit (sweep)', () => {
  it('wide canvas: limited by Y, centered in X, with the min corner as the origin', () => {
    // avail 180×80, span 20×10 → scale min(9, 8) = 8; drawn 160×80; offsetX = 10 + 10 = 20.
    const fit = computeLayerFit({ minX: 10, minY: 20, maxX: 30, maxY: 30, hasContent: true }, 200, 100, 10);
    expect(fit.scale).toBe(8);
    expect(fit.project(10, 20)).toEqual([20, 90]);
    expect(fit.project(30, 30)).toEqual([180, 10]);
    expect(fit.project(20, 25)).toEqual([100, 50]);
  });

  it('wide bounds: limited by X, centered in Y', () => {
    // avail 80×80, span 20×10 → scale min(4, 8) = 4; drawn 80×40; offsetYTop = 10 + 20 = 30.
    const fit = computeLayerFit({ minX: 0, minY: 0, maxX: 20, maxY: 10, hasContent: true }, 100, 100, 10);
    expect(fit.scale).toBe(4);
    expect(fit.project(0, 0)).toEqual([10, 70]);
    expect(fit.project(20, 10)).toEqual([90, 30]);
  });

  it('a straight line along X still fits (zero Y span is not degenerate)', () => {
    const fit = computeLayerFit({ minX: 0, minY: 5, maxX: 10, maxY: 5, hasContent: true }, 100, 100, 10);
    expect(fit.scale).toBe(8);
    expect(fit.project(0, 5)).toEqual([10, 50]);
    expect(fit.project(10, 5)).toEqual([90, 50]);
  });

  it('hasContent:false wins over a non-zero span (scale 1)', () => {
    const fit = computeLayerFit({ minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: false }, 100, 100, 10);
    expect(fit.scale).toBe(1);
  });

  it('padding wider than the canvas leaves a 1 px drawable area on that axis', () => {
    const b: LayerBounds2D = { minX: 0, minY: 0, maxX: 1, maxY: 1, hasContent: true };
    expect(computeLayerFit(b, 10, 40, 8).scale).toBe(1);
    expect(computeLayerFit(b, 40, 10, 8).scale).toBe(1);
  });

  it('default padding is 8 px', () => {
    // avail 84 / span 10 → 8.4
    const fit = computeLayerFit({ minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: true }, 100, 100);
    expect(fit.scale).toBeCloseTo(8.4, 12);
    expect(fit.project(0, 0)).toEqual([8, 92]);
  });
});

describe('drawLayer (sweep)', () => {
  const single: ColorMode = { mode: 'single', color: [1, 0, 0] };

  it('strokes each segment from its start to its end point (travel and extrusion)', () => {
    const ir = irOf([
      { x0: 1, y0: 2, x1: 3, y1: 4, kind: MoveKind.Travel },
      { x0: 3, y0: 4, x1: 5, y1: 6 }
    ]);
    const m = new MockCtx();
    drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit, travel: { color: '#888' } });
    expect(m.strokes.map((s) => [s.from, s.to])).toEqual([
      [
        [10, 200],
        [30, 400]
      ],
      [
        [30, 400],
        [50, 600]
      ]
    ]);
  });

  it('defaults: round caps/joins, extrusion width 1, travel width 0.5, alpha 1', () => {
    const ir = makeIR(1, 2);
    const m = new MockCtx();
    drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit, travel: { color: '#888' } });
    expect(m.lineCap).toBe('round');
    expect(m.lineJoin).toBe('round');
    // travel first (0.5), then the two extrusion strokes back at width 1
    expect(m.strokes.map((s) => s.width)).toEqual([0.5, 1, 1]);
    expect(m.strokes.map((s) => s.alpha)).toEqual([1, 1, 1]);
  });

  it('travel strokes take the layer opacity', () => {
    const ir = makeIR(1, 1);
    const m = new MockCtx();
    drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit, travel: { color: '#888' }, opacity: 0.4 });
    expect(m.strokes[0]).toMatchObject({ style: '#888', alpha: 0.4 });
  });

  it('draws the layer’s last segment when it is an extrusion', () => {
    const ir = irOf([
      { x0: 0, y0: 0, x1: 1, y1: 0, kind: MoveKind.Travel },
      { x0: 1, y0: 0, x1: 2, y1: 0 }
    ]);
    const m = new MockCtx();
    const res = drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit });
    expect(res.extrudeDrawn).toBe(1);
  });

  it('upcoming (not-yet-printed) opacity is relative to the layer opacity', () => {
    const ir = makeIR(1, 2); // extrusion 0,1
    const m = new MockCtx();
    drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit, opacity: 0.5, progressCutSeg: 0 });
    expect(m.strokes[0].alpha).toBe(0.5);
    expect(m.strokes[1].alpha).toBeCloseTo(0.075, 12);
  });

  it('never reads past segments.count, even when segEnd overshoots it', () => {
    const ir = makeIR(1, 2); // 3 segments
    ir.layers[0] = { ...ir.layers[0], segEnd: 1_000_000 };
    const reads: number[] = [];
    ir.segments.kind = recordReads(ir.segments.kind, reads);
    const m = new MockCtx();
    const res = drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit, travel: { color: '#888' } });
    expect(res).toMatchObject({ extrudeDrawn: 2, travelDrawn: 1 });
    expect(Math.max(...reads)).toBe(2);
  });

  it('a hostile negative segStart is clamped to 0 (no billion-step loop)', () => {
    const ir = makeIR(1, 2);
    ir.layers[0] = { ...ir.layers[0], segStart: -1e15 };
    ir.segments.kind = readBudget(ir.segments.kind, 100, 'segments.kind');
    ir.segments.x0 = readBudget(ir.segments.x0, 100, 'segments.x0');
    const m = new MockCtx();
    const res = drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit, travel: { color: '#888' } });
    expect(res).toMatchObject({ extrudeDrawn: 2, travelDrawn: 1, skippedNonFinite: 0 });
    expect(layerBounds2D(ir, 0)).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 1, hasContent: true });
  });

  it('a fractional segEnd stops at its integer part (1.5 → segments 0 and 1)', () => {
    const ir = makeIR(1, 3); // extrusion 0..2 (x 0→1, 1→2, 2→3), travel 3
    ir.layers[0] = { ...ir.layers[0], segEnd: 1.5 };
    const res = drawLayer(new MockCtx().ctx, ir, { layer: 0, colorMode: single, fit: scaleFit });
    expect(res).toMatchObject({ extrudeDrawn: 2, travelDrawn: 0 });
    expect(layerBounds2D(ir, 0)).toEqual({ minX: 0, minY: 0, maxX: 2, maxY: 0, hasContent: true });
  });
});

describe('drawLayers (sweep)', () => {
  const single: ColorMode = { mode: 'single', color: [1, 0, 0] };

  it('defaults: one ghost layer at 0.25 opacity', () => {
    const ir = makeIR(3, 2);
    const m = new MockCtx();
    const res = drawLayers(m.ctx, ir, { layer: 2, colorMode: single, fit: scaleFit });
    expect(res.ghostLayers).toEqual([1]);
    expect(m.strokes.map((s) => s.alpha)).toEqual([0.25, 0.25, 1, 1]);
  });

  it('a fractional adjacentLayers is floored (1.5 → 1 ghost)', () => {
    const ir = makeIR(3, 2);
    const res = drawLayers(new MockCtx().ctx, ir, { layer: 2, adjacentLayers: 1.5, colorMode: single, fit: scaleFit });
    expect(res.ghostLayers).toEqual([1]);
  });

  it('adjacentLayers: Infinity draws every layer below, without hanging', () => {
    const ir = makeIR(3, 2);
    ir.layers = readBudget(ir.layers, 200, 'ir.layers');
    const res = drawLayers(new MockCtx().ctx, ir, {
      layer: 2,
      adjacentLayers: Infinity,
      colorMode: single,
      fit: scaleFit
    });
    expect(res.ghostLayers).toEqual([0, 1]);
  });

  it('a hole in a consumer-built layer table is skipped, not reported as a ghost', () => {
    const ir = makeIR(3, 2);
    delete (ir.layers as unknown as Record<number, unknown>)[1];
    const res = drawLayers(new MockCtx().ctx, ir, { layer: 2, adjacentLayers: 2, colorMode: single, fit: scaleFit });
    expect(res.ghostLayers).toEqual([0]);
    expect(res.extrudeDrawn).toBe(4);
  });

  it('a progress point with an unknown segment (segIndex null) dims nothing', () => {
    const ir = makeIR(1, 3);
    const m = new MockCtx();
    drawLayers(m.ctx, ir, {
      layer: 0,
      adjacentLayers: 0,
      colorMode: single,
      fit: scaleFit,
      progress: { segIndex: null, layerIndex: 0 }
    });
    expect(m.strokes.map((s) => s.alpha)).toEqual([1, 1, 1]);
  });

  it('travel and lineWidth reach the active layer; ghosts get lineWidth but never travel', () => {
    const ir = makeIR(2, 2);
    const m = new MockCtx();
    const res = drawLayers(m.ctx, ir, {
      layer: 1,
      adjacentLayers: 1,
      colorMode: single,
      fit: scaleFit,
      lineWidth: 3,
      travel: { color: '#888', lineWidth: 2 }
    });
    expect(res.travelDrawn).toBe(1);
    // ghost extrusion ×2 (w3), active travel (w2), active extrusion ×2 (w3)
    expect(m.strokes.map((s) => s.width)).toEqual([3, 3, 2, 3, 3]);
  });
});

describe('LayerView2D (sweep)', () => {
  it('defaults: layer 0, mid-green single color, width 1, no travel, 8 px padding, whole-model frame', () => {
    const m = new MockCtx();
    const view = new LayerView2D(fakeCanvas(200, 100, m));
    view.setToolpath(makeIR(3, 2)); // model frame x 0..2, y 0..3
    const res = view.render();
    expect(res).toMatchObject({
      layer: 0,
      layerCount: 3,
      ghostLayers: [],
      extrudeDrawn: 2,
      travelDrawn: 0,
      drawn: true
    });
    expect(m.clears).toBe(1);
    // avail 184×84, span 2×3 → scale 28; drawn 56×84; offsetX = 8 + 64 = 72, offsetYTop = 8.
    expect(m.strokes[0]).toEqual({ style: 'rgb(140, 184, 140)', from: [72, 92], to: [100, 92], width: 1, alpha: 1 });
  });

  it('default ghost: one layer below at 0.25', () => {
    const m = new MockCtx();
    const view = new LayerView2D(fakeCanvas(100, 100, m));
    view.setToolpath(makeIR(3, 2));
    view.setLayer(1);
    const res = view.render();
    expect(res.ghostLayers).toEqual([0]);
    expect(m.strokes.map((s) => s.alpha)).toEqual([0.25, 0.25, 1, 1]);
  });

  it('constructor options reach the draw', () => {
    const m = new MockCtx();
    const view = new LayerView2D(fakeCanvas(100, 100, m), {
      layer: 1,
      colorMode: { mode: 'single', color: [0, 0, 1] },
      lineWidth: 3,
      travel: { color: '#888' },
      padding: 0,
      adjacentLayers: 0,
      ghostOpacity: 0.5
    });
    view.setToolpath(makeIR(3, 2));
    const res = view.render();
    expect(res).toMatchObject({ layer: 1, ghostLayers: [], travelDrawn: 1, extrudeDrawn: 2 });
    expect(m.strokes.map((s) => [s.style, s.width])).toEqual([
      ['#888', 0.5],
      ['rgb(0, 0, 255)', 3],
      ['rgb(0, 0, 255)', 3]
    ]);
    // padding 0: avail 100, span 2×3 → scale 33.33…; first extrusion of layer 1 starts at (0, 1).
    expect(m.strokes[1].from[0]).toBeCloseTo(100 / 6, 9);
    view.setAdjacentLayers(1);
    const m2 = m.strokes.length;
    view.render();
    expect(m.strokes.slice(m2).map((s) => s.alpha)).toEqual([0.5, 0.5, 1, 1, 1]);
  });

  it('an invalid colour mode throws at construction, before anything is stored', () => {
    expect(
      () =>
        new LayerView2D(fakeCanvas(100, 100, new MockCtx()), {
          colorMode: { mode: 'feedrate', ramp: [[0, 0, 1]], range: [0, Number.NaN], fallback: [0, 0, 0] }
        })
    ).toThrow('feedrate color range must be two finite numbers >= 0, got [0, NaN]');
  });

  it('setColorMode throws synchronously; the previous mode stays and a valid one still applies', () => {
    const m = new MockCtx();
    const view = new LayerView2D(fakeCanvas(100, 100, m), { colorMode: { mode: 'single', color: [0, 0, 1] } });
    view.setToolpath(makeIR(1, 1));
    expect(() => view.setColorMode({ mode: 'object', palette: [[1, 0, 0]], fallback: [0, 0, 0], only: 0 })).toThrow(
      "object color mode 'only' must be a 1-based integer object index, got 0"
    );
    view.render();
    expect(m.strokes.map((s) => s.style)).toEqual(['rgb(0, 0, 255)']);
    view.setColorMode({ mode: 'single', color: [1, 0, 0] });
    view.render();
    expect(m.strokes.map((s) => s.style)).toEqual(['rgb(0, 0, 255)', 'rgb(255, 0, 0)']);
  });

  it('setToolpath clamps an out-of-range layer to the last one; an empty IR to 0', () => {
    const view = new LayerView2D(fakeCanvas(100, 100, new MockCtx()), { layer: 10 });
    view.setToolpath(makeIR(3, 2));
    expect(view.render().layer).toBe(2);
    view.setToolpath(irOf([]));
    expect(view.render()).toMatchObject({ layer: 0, layerCount: 0, drawn: false });
  });

  it('setLayer floors negatives at 0', () => {
    const view = new LayerView2D(fakeCanvas(100, 100, new MockCtx()));
    view.setToolpath(makeIR(2, 2));
    view.setLayer(-3);
    expect(view.render()).toMatchObject({ layer: 0, drawn: true });
  });

  it('setters reach the next render: colour, travel, progress', () => {
    const m = new MockCtx();
    const view = new LayerView2D(fakeCanvas(100, 100, m), { adjacentLayers: 0 });
    view.setToolpath(makeIR(1, 3)); // extrusion 0..2, travel 3
    view.setColorMode({ mode: 'single', color: [1, 1, 0] });
    view.setTravel({ color: '#123' });
    view.setProgress({ segIndex: 0, layerIndex: 0 });
    const res = view.render();
    expect(res.travelDrawn).toBe(1);
    expect(m.strokes.map((s) => [s.style, s.alpha])).toEqual([
      ['#123', 1],
      ['rgb(255, 255, 0)', 1],
      ['rgb(255, 255, 0)', 0.15],
      ['rgb(255, 255, 0)', 0.15]
    ]);
  });

  it('disclosures and layerCount follow the current IR', () => {
    const view = new LayerView2D(fakeCanvas(100, 100, new MockCtx()));
    expect(view.layerCount).toBe(0);
    expect(view.getDisclosures()).toEqual([]);
    const ir = makeIR(2, 2);
    ir.header.capabilities['layers'] = 'inferred';
    view.setToolpath(ir);
    expect(view.layerCount).toBe(2);
    expect(view.getDisclosures()).toEqual(['Layer index is inferred; layer boundaries may be approximate.']);
  });

  it('no 2D context or no IR → an honest empty result, no throw', () => {
    const noCtx = new LayerView2D(fakeCanvas(100, 100, null));
    noCtx.setToolpath(makeIR(1, 1));
    expect(noCtx.render()).toMatchObject({ drawn: false, extrudeDrawn: 0 });
    const m = new MockCtx();
    const noIr = new LayerView2D(fakeCanvas(100, 100, m));
    expect(noIr.render()).toMatchObject({ drawn: false, layerCount: 0 });
    expect(m.clears).toBe(1);
  });
});

describe('non-finite coordinates (#501): ignored, counted, never a NaN transform', () => {
  const single: ColorMode = { mode: 'single', color: [1, 0, 0] };

  /** Two good extrusion segments + one whose end X is `bad`, all on layer 0. */
  function irWithBad(bad: number): ToolpathIR {
    const ir = irOf([
      { x0: 0, y0: 0, x1: 10, y1: 0 },
      { x0: 10, y0: 0, x1: 99, y1: 99 },
      { x0: 10, y0: 0, x1: 10, y1: 10 }
    ]);
    ir.segments.x1[1] = bad;
    return ir;
  }

  for (const bad of [Infinity, -Infinity, Number.NaN]) {
    it(`layerBounds2D and modelBounds2D ignore a segment with x1 = ${bad}`, () => {
      const ir = irWithBad(bad);
      const expected = { minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: true };
      expect(layerBounds2D(ir, 0)).toEqual(expected);
      expect(modelBounds2D(ir)).toEqual(expected);
    });

    it(`drawLayer skips (and counts) a segment with x1 = ${bad}`, () => {
      const ir = irWithBad(bad);
      const m = new MockCtx();
      const res = drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit });
      expect(res).toMatchObject({ extrudeDrawn: 2, travelDrawn: 0, skippedNonFinite: 1, drawn: true });
      expect(m.strokes.map((s) => [s.from, s.to])).toEqual([
        [
          [0, 0],
          [100, 0]
        ],
        [
          [100, 0],
          [100, 1000]
        ]
      ]);
    });
  }

  it('a non-finite travel move is skipped and counted too', () => {
    const ir = irOf([
      { x0: 0, y0: 0, x1: 1, y1: 0, kind: MoveKind.Travel },
      { x0: 1, y0: 0, x1: 2, y1: 0, kind: MoveKind.Travel }
    ]);
    ir.segments.y0[0] = Infinity;
    const m = new MockCtx();
    const res = drawLayer(m.ctx, ir, { layer: 0, colorMode: single, fit: scaleFit, travel: { color: '#888' } });
    expect(res).toMatchObject({ travelDrawn: 1, skippedNonFinite: 1 });
    expect(m.strokes).toHaveLength(1);
  });

  it('drawLayers sums the skipped count across ghosts and the active layer', () => {
    const ir = irOf([
      { x0: 0, y0: 0, x1: 1, y1: 0, layer: 0 },
      { x0: 0, y0: 0, x1: 1, y1: 0, layer: 1 }
    ]);
    ir.segments.x0[0] = Number.NaN;
    ir.segments.y1[1] = -Infinity;
    const res = drawLayers(new MockCtx().ctx, ir, { layer: 1, adjacentLayers: 1, colorMode: single, fit: scaleFit });
    expect(res).toMatchObject({ ghostLayers: [0], extrudeDrawn: 0, skippedNonFinite: 2 });
  });

  it('computeLayerFit with non-finite bounds falls back to scale 1 at the canvas centre', () => {
    const fit = computeLayerFit({ minX: 0, minY: 0, maxX: Infinity, maxY: 10, hasContent: true }, 100, 100, 10);
    expect(fit.scale).toBe(1);
    expect(fit.project(0, 0)).toEqual([50, 50]);
    expect(fit.project(3, 4)).toEqual([53, 46]);
    const nanFit = computeLayerFit({ minX: Number.NaN, minY: 0, maxX: 1, maxY: 1, hasContent: true }, 100, 100, 10);
    expect(nanFit.project(0, 0)).toEqual([50, 50]);
  });

  it('computeLayerFit with a non-finite canvas size or padding stays finite', () => {
    const b: LayerBounds2D = { minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: true };
    // NaN width → treated as 0 → 1 px drawable; padding 0 → height avail 100 → scale min(0.1, 10).
    const fit = computeLayerFit(b, Number.NaN, 100, 0);
    expect(fit.scale).toBe(0.1);
    expect(fit.project(10, 10)).toEqual([1, 49.5]);
    const padFit = computeLayerFit(b, 100, 100, Number.NaN); // NaN padding → 0
    expect(padFit.scale).toBe(10);
    expect(padFit.project(10, 10)).toEqual([100, 0]);
  });

  it('LayerView2D: one Infinity coordinate no longer blanks the canvas', () => {
    const m = new MockCtx();
    const view = new LayerView2D(fakeCanvas(100, 100, m), { adjacentLayers: 0, padding: 0 });
    view.setToolpath(irWithBad(Infinity));
    const res = view.render();
    expect(res).toMatchObject({ extrudeDrawn: 2, skippedNonFinite: 1, drawn: true });
    // frame = the finite segments' 0..10 square → scale 10
    expect(m.strokes.map((s) => [s.from, s.to])).toEqual([
      [
        [0, 100],
        [100, 100]
      ],
      [
        [100, 100],
        [100, 0]
      ]
    ]);
  });
});

describe('computeLayerFit: every non-finite bounds edge falls back (#501)', () => {
  const edges: Array<keyof Omit<LayerBounds2D, 'hasContent'>> = ['minX', 'minY', 'maxX', 'maxY'];
  for (const edge of edges) {
    for (const bad of [Infinity, -Infinity, Number.NaN]) {
      it(`${edge} = ${bad} → scale 1, origin at the canvas centre`, () => {
        const b: LayerBounds2D = { minX: 2, minY: 3, maxX: 12, maxY: 13, hasContent: true };
        b[edge] = bad;
        const fit = computeLayerFit(b, 100, 60, 10);
        expect(fit.scale).toBe(1);
        expect(fit.project(0, 0)).toEqual([50, 30]);
        expect(fit.project(5, 5)).toEqual([55, 25]);
      });
    }
  }

  it('a NaN canvas height is treated as 0 (1 px drawable on that axis)', () => {
    const b: LayerBounds2D = { minX: 0, minY: 0, maxX: 10, maxY: 10, hasContent: true };
    const fit = computeLayerFit(b, 100, Number.NaN, 0);
    expect(fit.scale).toBe(0.1);
    expect(fit.project(10, 10)).toEqual([50.5, 0]);
  });
});
