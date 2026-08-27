/*
 * renderStill unit contract (#132 / DD-008 §4.8). Runs headless with an injected
 * GL backend (no real WebGL): asserts the build-to-completion + single-render
 * lifecycle, the IR and bytes input paths, camera pose override, and clip
 * options. GPU pixel determinism is covered separately by the browser check.
 */
import { describe, it, expect } from 'vitest';
import {
  handleGeometryRequest,
  type GeometryBuildRequest,
  type GeometryWorkerLike,
  type GLRendererLike,
  type RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { renderStill } from '../render-still.js';
import { makeTestIR, SuiteStubWorker } from '../testing.js';

/** An IR with an extrusion segment plus a travel segment and a wipe segment (distinct geometry chunks). */
function makeMixedIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({
    parserVersion: 'render-still-test',
    units: 'mm',
    unitsSource: 'known',
    source: { byteLength: 100 }
  });
  b.addSegment({
    x0: 100,
    y0: 100,
    z0: 0.2,
    x1: 110,
    y1: 100,
    z1: 0.2,
    e: 1,
    kind: MoveKind.Extrude,
    layer: 0,
    srcByte: 0
  });
  b.addSegment({
    x0: 110,
    y0: 100,
    z0: 0.2,
    x1: 120,
    y1: 110,
    z1: 0.2,
    e: 0,
    kind: MoveKind.Travel,
    layer: 0,
    srcByte: 10
  });
  b.addSegment({
    x0: 120,
    y0: 110,
    z0: 0.2,
    x1: 118,
    y1: 110,
    z1: 0.2,
    e: 0,
    kind: MoveKind.Wipe,
    layer: 0,
    srcByte: 20
  });
  return b.finalize();
}

/**
 * GL stub that, on each render, snapshots the `.visible` state of the 'travel' and 'wipe' geometry
 * chunk meshes in the scene — lets a test observe kind visibility inside renderStill (which disposes
 * its renderer internally, so post-call inspection isn't possible).
 */
function makeKindProbeGL(): {
  gl: (c: RenderTargetCanvas) => GLRendererLike;
  visible: (kind: string) => boolean | null;
} {
  const seen: Record<string, boolean | null> = {};
  return {
    gl: (canvas: RenderTargetCanvas) => ({
      render: (scene?: {
        traverse(cb: (o: { userData?: { chunk?: { kind?: string } }; visible?: boolean }) => void): void;
      }) => {
        if (scene && typeof scene.traverse === 'function') {
          scene.traverse((o) => {
            const kind = o.userData?.chunk?.kind;
            if (kind) seen[kind] = o.visible ?? null;
          });
        }
      },
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    }),
    visible: (kind: string) => seen[kind] ?? null
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
    expect(result.decimationApplied).toBe(1); // small IR → no decimation, disclosed as 1
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

  it('hides travel & wipe by default and honors showTravel/showWipe:false (regression: :false was a no-op)', async () => {
    // Default (omitted) → travel AND wipe hidden (documented clean-still defaults).
    const def = makeKindProbeGL();
    await renderStill(makeMixedIR(), { canvas: makeStubCanvas(), createRenderer: def.gl });
    expect(def.visible('travel')).toBe(false);
    expect(def.visible('wipe')).toBe(false);

    // Explicit false → hidden.
    const off = makeKindProbeGL();
    await renderStill(makeMixedIR(), {
      canvas: makeStubCanvas(),
      showTravel: false,
      showWipe: false,
      createRenderer: off.gl
    });
    expect(off.visible('travel')).toBe(false);
    expect(off.visible('wipe')).toBe(false);

    // Explicit true → visible.
    const on = makeKindProbeGL();
    await renderStill(makeMixedIR(), {
      canvas: makeStubCanvas(),
      showTravel: true,
      showWipe: true,
      createRenderer: on.gl
    });
    expect(on.visible('travel')).toBe(true);
    expect(on.visible('wipe')).toBe(true);
  });

  it('accepts the background convenience option (transparent + solid) without throwing (#306)', async () => {
    // Explicit createRenderer wins over the transparent alpha-injection, so this stays headless-safe.
    const t = makeCountingGL();
    const rt = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      background: 'transparent',
      createRenderer: t.gl
    });
    expect(rt.segmentCount).toBe(12);
    expect(t.renders()).toBeGreaterThan(0);
    const c = makeCountingGL();
    const rc = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      background: '#112233',
      createRenderer: c.gl
    });
    expect(rc.segmentCount).toBe(12);
    expect(c.renders()).toBeGreaterThan(0);
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

  it('parallelizes the tube build across the browser Web Worker pool, identically to serial (DD-028 Phase 4)', async () => {
    // A multi-chunk tube IR; geometryConcurrency:2 forces the pool via an injected synchronous worker.
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    let src = 0;
    for (let l = 0; l < 4; l++) {
      for (let s = 0; s < 800; s++) {
        b.addSegment({
          x0: 100 + s,
          y0: 100 + l,
          z0: 0.2 * (l + 1),
          x1: 101 + s,
          y1: 100 + l,
          z1: 0.2 * (l + 1),
          e: 1,
          kind: MoveKind.Extrude,
          layer: l,
          srcByte: src++ * 10
        });
      }
    }
    const ir: ToolpathIR = b.finalize();

    let workerCalls = 0;
    const syncWorker = (): GeometryWorkerLike => {
      const w: GeometryWorkerLike = {
        onmessage: null,
        onerror: null,
        postMessage: (msg: GeometryBuildRequest) => {
          workerCalls++;
          const { response } = handleGeometryRequest(msg);
          queueMicrotask(() => w.onmessage?.({ data: response }));
        },
        terminate: () => undefined
      };
      return w;
    };

    const pooled = await renderStill(ir, {
      canvas: makeStubCanvas(),
      quality: 'tubes',
      geometryConcurrency: 2,
      createGeometryWorker: syncWorker,
      createRenderer: makeCountingGL().gl
    });
    const serial = await renderStill(ir, {
      canvas: makeStubCanvas(),
      quality: 'tubes',
      geometryConcurrency: 'off',
      createRenderer: makeCountingGL().gl
    });

    // The pool was used (workers dispatched), and the result is identical to the serial build.
    expect(workerCalls).toBeGreaterThan(0);
    expect(pooled.quality).toBe('tubes');
    expect(serial.quality).toBe('tubes');
    expect(pooled.segmentCount).toBe(serial.segmentCount);
    expect(pooled.decimationApplied).toBe(serial.decimationApplied);
  });

  it('forwards tubeByteBudget: a generous budget keeps tubes, a tiny one degrades to lines (RR-006)', async () => {
    // Exposes the final-geometry budget through renderStill so a deployment with RAM to spare can retain
    // tubes on a large plate instead of silently falling to lines (the default budget is conservative).
    // Separate axis from geometryMemoryBudgetBytes (the parallel-build transient cap).
    const generous = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      quality: 'tubes',
      tubeByteBudget: 1_000_000_000,
      createRenderer: makeCountingGL().gl
    });
    expect(generous.quality).toBe('tubes');

    const starved = await renderStill(makeTestIR(), {
      canvas: makeStubCanvas(),
      quality: 'tubes',
      tubeByteBudget: 1000, // even a 3-sided tube for these segments exceeds this → honest lines fallback
      createRenderer: makeCountingGL().gl
    });
    expect(starved.quality).toBe('lines');
  });
});
