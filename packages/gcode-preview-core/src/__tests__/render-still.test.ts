/*
 * renderStill unit contract (#132 / DD-008 §4.8). Runs headless with an injected
 * GL backend (no real WebGL): asserts the build-to-completion + single-render
 * lifecycle, the IR and bytes input paths, camera pose override, and clip
 * options. GPU pixel determinism is covered separately by the browser check.
 */
import { describe, it, expect } from 'vitest';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { renderStill } from '../render-still.js';
import { makeTestIR, SuiteStubWorker } from '../testing.js';

/** An IR with both an extrusion segment and a travel segment (a distinct 'travel' geometry chunk). */
function makeTravelBearingIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'render-still-test',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 100 }
  });
  b.addSegment({ x0: 100, y0: 100, z0: 0.2, x1: 110, y1: 100, z1: 0.2, e: 1, kind: MoveKind.Extrude, layer: 0, srcByte: 0 });
  b.addSegment({ x0: 110, y0: 100, z0: 0.2, x1: 120, y1: 110, z1: 0.2, e: 0, kind: MoveKind.Travel, layer: 0, srcByte: 10 });
  return b.finalize();
}

/**
 * GL stub that, on each render, snapshots the `.visible` state of any 'travel' geometry chunk mesh
 * in the scene — lets a test observe travel visibility inside renderStill (which disposes internally).
 */
function makeTravelProbeGL(): {
  gl: (c: RenderTargetCanvas) => GLRendererLike;
  travelVisible: () => boolean | null;
} {
  let travelVisible: boolean | null = null;
  return {
    gl: (canvas: RenderTargetCanvas) => ({
      render: (scene?: { traverse(cb: (o: { userData?: { chunk?: { kind?: string } }; visible?: boolean }) => void): void }) => {
        if (scene && typeof scene.traverse === 'function') {
          scene.traverse((o) => {
            if (o.userData?.chunk?.kind === 'travel') travelVisible = o.visible ?? null;
          });
        }
      },
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    }),
    travelVisible: () => travelVisible
  };
}

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

  it('renders with an orthographic camera (#150)', async () => {
    const counting = makeCountingGL();
    const result = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      cameraMode: 'orthographic',
      createRenderer: counting.gl
    });
    expect(result.segmentCount).toBe(12);
    expect(counting.renders()).toBeGreaterThan(0);
  });

  it('ignores a pose fov on an orthographic camera without throwing (#150 fov guard)', async () => {
    const counting = makeCountingGL();
    const result = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      cameraMode: 'orthographic',
      camera: { position: [10, 20, 30], target: [0, 0, 0], fov: 35 },
      createRenderer: counting.gl
    });
    expect(result.segmentCount).toBe(12);
    expect(counting.renders()).toBeGreaterThan(0);
  });

  it('hides travel by default and honors showTravel:false (regression: showTravel:false was a no-op)', async () => {
    // Default (showTravel omitted) → travel hidden (documented default false).
    const def = makeTravelProbeGL();
    await renderStill(makeTravelBearingIR(), { canvas: makeStubCanvas(), createRenderer: def.gl });
    expect(def.travelVisible()).toBe(false);

    // Explicit false → travel hidden.
    const off = makeTravelProbeGL();
    await renderStill(makeTravelBearingIR(), { canvas: makeStubCanvas(), showTravel: false, createRenderer: off.gl });
    expect(off.travelVisible()).toBe(false);

    // Explicit true → travel visible.
    const on = makeTravelProbeGL();
    await renderStill(makeTravelBearingIR(), { canvas: makeStubCanvas(), showTravel: true, createRenderer: on.gl });
    expect(on.travelVisible()).toBe(true);
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
