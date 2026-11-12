// @vitest-environment happy-dom
/**
 * A rebuild (setIR) while the previous IR's pool build is still in flight must end up with the NEW IR's
 * geometry only. Before the pool matched replies to requests, the old build's reply was handed to the new
 * build's chunk (and the old build hung), so a mid-build file change could show the previous file's tubes.
 *
 * Workers here answer only when the test says so, so the overlap is deterministic.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type GeometryWorkerLike } from '../index.js';
import { handleGeometryRequest, type GeometryBuildRequest } from '../geometry-worker-core.js';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

/** `layers` layers of `perLayer` continuous 1 mm segments; each layer is one polyline → (perLayer+1)*9 vertices. */
function makeTubeIR(layers: number, perLayer: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let src = 0;
  for (let l = 0; l < layers; l++) {
    for (let s = 0; s < perLayer; s++) {
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

interface Held {
  worker: GeometryWorkerLike;
  queue: GeometryBuildRequest[];
  flush(): void;
}

/** A worker that queues requests and runs the REAL kernel on them only when `flush()` is called. */
function heldWorker(): Held {
  const queue: GeometryBuildRequest[] = [];
  const worker: GeometryWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg: GeometryBuildRequest) {
      queue.push(msg);
    },
    terminate() {}
  };
  return {
    worker,
    queue,
    flush() {
      for (const msg of queue.splice(0)) {
        const { response } = handleGeometryRequest(msg);
        worker.onmessage?.({ data: response });
      }
    }
  };
}

function totalVertices(r: ToolpathRenderer): number {
  let v = 0;
  for (const m of r.chunkMeshes) v += (m.geometry.getAttribute('position')?.count as number) ?? 0;
  return v;
}

describe('setIR while a pool build is in flight', () => {
  it("ends with the new IR's tubes only: 5 layers × 701 rings × 9 = 31 545 vertices, never the old IR's 43 254", async () => {
    const held: Held[] = [];
    const canvas = document.createElement('canvas');
    const stub: GLRendererLike = {
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    };
    const r = new ToolpathRenderer({
      canvas,
      quality: 'tubes',
      chunksPerTick: 8,
      geometryConcurrency: 2,
      createGeometryWorker: () => {
        const h = heldWorker();
        held.push(h);
        return h.worker;
      },
      createRenderer: () => stub,
      scheduleFrame: (cb) => queueMicrotask(cb)
    });

    r.setIR(makeTubeIR(6, 800)); // A: 6 × 801 × 9 = 43 254 vertices
    await settle();
    expect(held).toHaveLength(2);
    expect(held.map((h) => h.queue.length)).toEqual([1, 1]); // each worker holds A's first chunk

    r.setIR(makeTubeIR(5, 700)); // B arrives while A is mid-flight (same pool size → same pool)
    await settle();
    expect(held).toHaveLength(2); // the pool was reused, not rebuilt: the stale-reply window is real

    // Now the workers answer: first A's old requests, then B's, round after round.
    for (let round = 0; round < 40; round++) {
      held.forEach((h) => h.flush());
      await settle();
    }

    expect(totalVertices(r)).toBe(31_545);
    expect(r.getRenderStats()?.buildParallelism).toBe('pool');
    r.dispose();
  });
});
