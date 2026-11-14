/**
 * 2D draw-call digest goldens (#588 byte-identity proof).
 *
 * Each case parses a real FDM fixture, draws it with `drawLayers` into a recording 2D context, and
 * hashes the ordered draw stream: every stroke's style, line width, alpha, and its moveTo/lineTo
 * points. The digests were captured on dev BEFORE the #588 Cut change (first commit of that PR), so
 * any later change that moves an FDM stroke, its order, colour, width, or alpha fails here.
 *
 * Layers: first, middle, and top, each with travel hidden and shown, under a single colour and
 * the moveKind colour mode (which maps Extrude and Cut to the same colour slot).
 */
// Test-only Node reads (a fixture and a hash): this file never ships, so DD-007 §7's browser-side
// rule for core's runtime source doesn't apply. Core is the one package that depends on both the
// parser and renderer-2d, so the real-fixture 2D golden lives here.
// eslint-disable-next-line no-restricted-imports
import { createHash } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGcodeToIR } from '@chestnutlabs/gcode-parser';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import {
  computeLayerFit,
  drawLayers,
  modelBounds2D,
  type CanvasContext2DLike,
  type ColorMode
} from '@chestnutlabs/gcode-renderer-2d';

/** Records the draw stream as text lines; `digest()` is a sha256 over them. */
class DigestCtx {
  strokeStyle = '';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  strokes = 0;
  private path: string[] = [];
  private readonly hash = createHash('sha256');
  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    this.path.push(`M${x},${y}`);
  }
  lineTo(x: number, y: number): void {
    this.path.push(`L${x},${y}`);
  }
  stroke(): void {
    this.strokes++;
    this.hash.update(`${this.strokeStyle}|${this.lineWidth}|${this.globalAlpha}|${this.path.join(' ')}\n`);
  }
  clearRect(): void {
    this.hash.update('clear\n');
  }
  digest(): string {
    return this.hash.digest('hex');
  }
  get ctx(): CanvasContext2DLike {
    return this as unknown as CanvasContext2DLike;
  }
}

const SINGLE: ColorMode = { mode: 'single', color: [0.55, 0.72, 0.55] };
const MOVE_KIND: ColorMode = { mode: 'moveKind', cut: [1, 0.5, 0], travel: [0.3, 0.3, 0.3], fallback: [0, 0, 0] };
const TRAVEL = { color: '#888', lineWidth: 0.5 };

function load(name: string): ToolpathIR {
  const bytes = readFileSync(new URL(`../../../../test-data/gcodes/${name}`, import.meta.url));
  return parseGcodeToIR(new Uint8Array(bytes)).ir;
}

/** One digest over first/middle/top layers × travel off/on × single/moveKind colour. */
function digestOf(ir: ToolpathIR): { digest: string; strokes: number } {
  const d = new DigestCtx();
  const fit = computeLayerFit(modelBounds2D(ir), 800, 600, 8);
  const top = ir.layers.length - 1;
  for (const layer of [0, Math.floor(top / 2), top]) {
    for (const travel of [undefined, TRAVEL]) {
      for (const colorMode of [SINGLE, MOVE_KIND]) {
        d.clearRect();
        drawLayers(d.ctx, ir, { layer, adjacentLayers: 1, colorMode, fit, lineWidth: 1, travel });
      }
    }
  }
  return { digest: d.digest(), strokes: d.strokes };
}

// Captured at base (origin/dev adae6230, before the #588 Cut change). Literal values on purpose.
const GOLDEN: Record<string, { digest: string; strokes: number }> = {
  'screw.gcode': {
    digest: '048a0780b4fbbbd7f19b9478b3ddafbcc0602c681830213f8ead7355f8f79fe1',
    strokes: 6988
  },
  'calicat.gcode': {
    digest: 'b7ebc55b558b591d5a333080599163c13af393ec3af031da3f9b595df1c6c429',
    strokes: 1610
  },
  'vase.gcode': {
    digest: 'd4ecef67ac935f790a51b2df17991cdad57adb031caa3531f24cafff1212d9e6',
    strokes: 85572
  },
  'plant-sign.gcode': {
    digest: 'f1eb24662c2a264c67b4d9ab0f0c0ea04848ddec57413e31d9d9b114da0a2692',
    strokes: 25358
  }
};

describe('2D draw-call digest goldens (FDM, #588 byte-identity)', () => {
  for (const [name, golden] of Object.entries(GOLDEN)) {
    it(`${name}: the draw stream is unchanged`, () => {
      expect(digestOf(load(name))).toEqual(golden);
    });
  }
});

describe('2D draws CNC Cut moves (#588)', () => {
  // Every CNC fixture has `layers: 'unavailable'`: one layer 0 holding the whole file.
  const CNC: Array<[string, number]> = [
    ['gcodes/mach3.gcode', 177],
    ['gcodes/easel.gcode', 737],
    ['fixtures/cnc/router-inch-g20.gcode', 85]
  ];
  for (const [path, cuts] of CNC) {
    it(`${path}: ${cuts} Cut strokes by default, 0 with cut: false`, () => {
      const bytes = readFileSync(new URL(`../../../../test-data/${path}`, import.meta.url));
      const ir = parseGcodeToIR(new Uint8Array(bytes)).ir;
      const fit = computeLayerFit(modelBounds2D(ir), 800, 600, 8);
      const shown = new DigestCtx();
      const on = drawLayers(shown.ctx, ir, { layer: 0, colorMode: SINGLE, fit });
      expect(on).toMatchObject({ extrudeDrawn: 0, travelDrawn: 0, cutDrawn: cuts, drawn: true });
      expect(shown.strokes).toBe(cuts);
      const hidden = new DigestCtx();
      const off = drawLayers(hidden.ctx, ir, { layer: 0, colorMode: SINGLE, fit, cut: false });
      expect(off).toMatchObject({ extrudeDrawn: 0, cutDrawn: 0, drawn: true });
      expect(hidden.strokes).toBe(0);
    });
  }
});
