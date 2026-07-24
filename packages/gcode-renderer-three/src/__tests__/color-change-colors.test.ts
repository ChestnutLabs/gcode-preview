// @vitest-environment happy-dom
/**
 * M600 color-change coloring (DD-009 D2, #147): buildChunkColors shades each segment
 * by SWAP SLOT (count of color changes at or before it), reusing the palette-index
 * path — not seg.tool. Plus the scene capability gate for the 'colorChange' mode.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { buildChunkColors, type GeometryChunk, ToolpathRenderer, type GLRendererLike } from '../index.js';

/** 6 extrude segments; a single M600 color change before segment `swapAt` (if given). */
function makeIR(swapAt?: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let s = 0; s < 6; s++) {
    b.addSegment({
      x0: 100 + s,
      y0: 100,
      z0: 0.2,
      x1: 101 + s,
      y1: 100,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: s * 10
    });
  }
  if (swapAt !== undefined)
    b.addColorChange({ x: 100 + swapAt, y: 100, z: 0.2, segIndex: swapAt, srcByte: swapAt * 10, tool: 0 });
  const ir = b.finalize();
  if (swapAt !== undefined) ir.header.capabilities.colorChanges = 'known';
  return ir;
}

/** A chunk covering all 6 segments, index-aligned. */
function fullChunk(): GeometryChunk {
  return {
    kind: 'extrude',
    layerStart: 0,
    layerEnd: 0,
    count: 6,
    positions: new Float32Array(6 * 6),
    segIndices: Uint32Array.from([0, 1, 2, 3, 4, 5])
  };
}

const A: [number, number, number] = [1, 0, 0];
const B: [number, number, number] = [0, 1, 0];
const F: [number, number, number] = [0.5, 0.5, 0.5];

function segColor(colors: Float32Array, seg: number): [number, number, number] {
  return [colors[seg * 6], colors[seg * 6 + 1], colors[seg * 6 + 2]];
}

describe('colorChange coloring (#147)', () => {
  it('shades pre-swap segments slot 0 and post-swap segments slot 1', () => {
    const ir = makeIR(3); // swap before segment 3
    const colors = buildChunkColors(ir, fullChunk(), { mode: 'colorChange', palette: [A, B], fallback: F });
    expect(segColor(colors, 0)).toEqual(A);
    expect(segColor(colors, 2)).toEqual(A);
    expect(segColor(colors, 3)).toEqual(B);
    expect(segColor(colors, 5)).toEqual(B);
  });

  it('falls back when there are no color changes', () => {
    const ir = makeIR(); // no swaps
    const colors = buildChunkColors(ir, fullChunk(), { mode: 'colorChange', palette: [A, B], fallback: F });
    expect(segColor(colors, 0)).toEqual(F);
    expect(segColor(colors, 5)).toEqual(F);
  });

  it('wraps the palette by slot (more swaps than palette entries)', () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    for (let s = 0; s < 6; s++) {
      b.addSegment({
        x0: s,
        y0: 0,
        z0: 0.2,
        x1: s + 1,
        y1: 0,
        z1: 0.2,
        e: 1,
        kind: MoveKind.Extrude,
        layer: 0,
        srcByte: s
      });
    }
    b.addColorChange({ x: 2, y: 0, z: 0.2, segIndex: 2, srcByte: 2, tool: 0 });
    b.addColorChange({ x: 4, y: 0, z: 0.2, segIndex: 4, srcByte: 4, tool: 0 });
    const ir = b.finalize();
    const colors = buildChunkColors(ir, fullChunk(), { mode: 'colorChange', palette: [A, B], fallback: F });
    expect(segColor(colors, 1)).toEqual(A); // slot 0
    expect(segColor(colors, 3)).toEqual(B); // slot 1
    expect(segColor(colors, 5)).toEqual(A); // slot 2 -> wraps to palette[0]
  });
});

describe('colorChange capability gate (#147)', () => {
  function makeRenderer() {
    const canvas = document.createElement('canvas');
    const stub: GLRendererLike = {
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    };
    const ticks: (() => void)[] = [];
    const renderer = new ToolpathRenderer({
      canvas,
      chunksPerTick: 8,
      quality: 'lines',
      createRenderer: () => stub,
      scheduleFrame: (cb) => ticks.push(cb)
    });
    return {
      renderer,
      runTicks: () => {
        while (ticks.length > 0) ticks.shift()?.();
      }
    };
  }

  it('is available only when the IR carries M600 color changes', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR()); // no colorChanges
    runTicks();
    expect(renderer.isColorModeAvailable('colorChange')).toBe(false);
    expect(renderer.hasColorChanges).toBe(false);

    renderer.setIR(makeIR(3)); // has one
    runTicks();
    expect(renderer.isColorModeAvailable('colorChange')).toBe(true);
    expect(renderer.hasColorChanges).toBe(true);
    renderer.dispose();
  });
});
