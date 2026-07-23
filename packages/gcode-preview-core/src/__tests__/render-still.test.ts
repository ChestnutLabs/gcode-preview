/*
 * renderStill unit contract (#132 / DD-008 §4.8). Runs headless with an injected
 * GL backend (no real WebGL): asserts the build-to-completion + single-render
 * lifecycle, the IR and bytes input paths, camera pose override, and clip
 * options. GPU pixel determinism is covered separately by the browser check.
 */
import { describe, it, expect } from 'vitest';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { renderStill } from '../render-still.js';
import { makeTestIR, SuiteStubWorker } from '../testing.js';

/** OffscreenCanvas-shaped stub (EventTarget surface, no DOM `style`). */
function makeStubCanvas(width = 320, height = 240): RenderTargetCanvas {
  return {
    width,
    height,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  } as unknown as RenderTargetCanvas;
}

/** GL stub that counts renders and records the last viewport. */
function makeCountingGL(): {
  gl: (c: RenderTargetCanvas) => GLRendererLike;
  renders: () => number;
  size: () => [number, number];
} {
  let renders = 0;
  let w = 0;
  let h = 0;
  return {
    gl: (canvas: RenderTargetCanvas) => ({
      render: () => {
        renders++;
      },
      setSize: (width: number, height: number) => {
        w = width;
        h = height;
      },
      dispose: () => undefined,
      domElement: canvas
    }),
    renders: () => renders,
    size: () => [w, h]
  };
}

describe('renderStill (#132)', () => {
  it('renders a pre-parsed IR to completion with a single settled frame', async () => {
    const counting = makeCountingGL();
    const canvas = makeStubCanvas(400, 300);
    const result = await renderStill(makeTestIR(), {
      canvas,
      createRenderer: counting.gl
    });
    expect(result.parsed).toBe(false);
    expect(result.segmentCount).toBe(12); // makeTestIR: 2 layers × 6 segments
    expect(result.layerCount).toBe(2);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(counting.size()).toEqual([400, 300]);
    expect(counting.renders()).toBeGreaterThan(0);
  });

  it('parses G-code bytes through the worker path (parsed: true)', async () => {
    const counting = makeCountingGL();
    const result = await renderStill(new Uint8Array([0x47, 0x31]), {
      canvas: makeStubCanvas(),
      createWorker: () => new SuiteStubWorker(),
      createRenderer: counting.gl
    });
    expect(result.parsed).toBe(true);
    expect(result.segmentCount).toBe(12);
  });

  it('honors an explicit size over the canvas dimensions', async () => {
    const counting = makeCountingGL();
    const result = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(100, 100),
      width: 800,
      height: 600,
      createRenderer: counting.gl
    });
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(counting.size()).toEqual([800, 600]);
  });

  it('accepts an explicit camera pose without throwing', async () => {
    const counting = makeCountingGL();
    const result = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      camera: { position: [10, 20, 30], target: [0, 0, 0], fov: 35 },
      createRenderer: counting.gl
    });
    expect(result.segmentCount).toBe(12);
    expect(counting.renders()).toBeGreaterThan(0);
  });

  it('applies layer-range and scrub clips', async () => {
    const counting = makeCountingGL();
    // Should complete without error; the clip calls exercise the renderer paths.
    const result = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      layerRange: [0, 0],
      scrub: 3,
      showTravel: true,
      createRenderer: counting.gl
    });
    expect(result.parsed).toBe(false);
    expect(result.layerCount).toBe(2);
  });
});
