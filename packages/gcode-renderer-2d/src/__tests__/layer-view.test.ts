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
  computeLayerFit,
  drawLayer,
  layerBounds2D,
  rgbToCss,
  type CanvasContext2DLike,
  type LayerBounds2D
} from '../index.js';

interface Stroke {
  style: string;
  from: [number, number];
  to: [number, number];
  width: number;
}

/** A minimal recording 2D context: captures each stroked segment with its style/width. */
class MockCtx {
  strokeStyle: string = '';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
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
    this.strokes.push({ style: this.strokeStyle, from: this.start, to: this.cur, width: this.lineWidth });
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
});
