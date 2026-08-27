// @vitest-environment happy-dom
/**
 * DD-028 — the renderer build path uses the worker pool for tube builds (geometryConcurrency), producing
 * the same scene as the synchronous path. Uses an injected synchronous geometry worker (the real kernel
 * on a microtask), so no real threads are needed.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type GeometryWorkerLike } from '../index.js';
import { handleGeometryRequest, type GeometryBuildRequest } from '../geometry-worker-core.js';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeTubeIR(layers: number, perLayer: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let src = 0;
  for (let l = 0; l < layers; l++) {
    for (let s = 0; s < perLayer; s++) {
      // Continuous within a layer so tubes form real polylines.
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
  return b.finalize();
}

/** The real kernel on a microtask (async, like a real worker). */
function syncGeometryWorker(): GeometryWorkerLike {
  const w: GeometryWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg: GeometryBuildRequest) {
      const { response } = handleGeometryRequest(msg);
      queueMicrotask(() => w.onmessage?.({ data: response }));
    },
    terminate() {}
  };
  return w;
}

function makeRenderer(opts: { concurrency: 'auto' | 'off' | number; withWorker?: boolean }) {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  return new ToolpathRenderer({
    canvas,
    quality: 'tubes',
    chunksPerTick: 8,
    geometryConcurrency: opts.concurrency,
    ...(opts.withWorker === false ? {} : { createGeometryWorker: syncGeometryWorker }),
    createRenderer: () => stub,
    scheduleFrame: (cb) => queueMicrotask(cb)
  });
}

function tubeVertexTotal(r: ToolpathRenderer): number {
  let v = 0;
  for (const m of r.chunkMeshes) v += (m.geometry.getAttribute('position')?.count as number) ?? 0;
  return v;
}

describe('DD-028 renderer pool wiring', () => {
  it('a forced pool build produces the same scene as the synchronous build (byte-equivalent geometry)', async () => {
    // geometryConcurrency:2 forces the pool (bypassing the size threshold) over a multi-chunk tube build.
    const pooled = makeRenderer({ concurrency: 2 });
    pooled.setIR(makeTubeIR(6, 800)); // 4800 extrude segs → multiple tube chunks
    await settle();

    const serial = makeRenderer({ concurrency: 'off' });
    serial.setIR(makeTubeIR(6, 800));
    await settle();

    // The pool was actually used, with the requested worker count.
    const stats = pooled.getRenderStats();
    expect(stats?.buildParallelism).toBe('pool');
    expect(stats?.workerCount).toBe(2);
    expect(stats?.geometryMode).toBe('tubes');

    // Same scene: identical mesh count and identical total tube vertices as the serial build.
    expect(pooled.chunkMeshes.length).toBe(serial.chunkMeshes.length);
    expect(pooled.chunkMeshes.length).toBeGreaterThan(1);
    expect(tubeVertexTotal(pooled)).toBe(tubeVertexTotal(serial));
    expect(serial.getRenderStats()?.buildParallelism).toBe('main');

    pooled.dispose();
    serial.dispose();
  });

  it("stays on the main thread for 'auto' below the cost threshold, and when no worker factory is given", async () => {
    const small = makeRenderer({ concurrency: 'auto' }); // tiny build → below threshold
    small.setIR(makeTubeIR(4, 20));
    await settle();
    expect(small.getRenderStats()?.buildParallelism).toBe('main');
    small.dispose();

    const noWorker = makeRenderer({ concurrency: 2, withWorker: false }); // no factory → can't pool
    noWorker.setIR(makeTubeIR(6, 800));
    await settle();
    expect(noWorker.getRenderStats()?.buildParallelism).toBe('main');
    noWorker.dispose();
  });

  it("'auto' engages the pool once the cost estimate crosses the threshold", async () => {
    // ~80k extrude segments — over the render-cost engage threshold (DD-028 D4), so 'auto' fans out.
    const big = makeRenderer({ concurrency: 'auto' });
    big.setIR(makeTubeIR(100, 800));
    await settle();
    const stats = big.getRenderStats();
    expect(stats?.buildParallelism).toBe('pool');
    expect(stats?.workerCount).toBeGreaterThanOrEqual(1);
    expect(stats?.geometryMode).toBe('tubes');
    big.dispose();
  });
});
