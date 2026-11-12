// @vitest-environment happy-dom
/**
 * #537 fix round 1: id-matched worker errors, layer-range draw bounds on an inconsistent IR, setQualityMode
 * validation. Literal expectations only.
 */
import { describe, expect, it } from 'vitest';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type GeometryWorkerLike } from '../index.js';
import { GeometryWorkerPool } from '../geometry-pool.js';
import {
  handleGeometryMessage,
  type GeometryBuildError,
  type GeometryBuildRequest,
  type GeometryBuildResponse
} from '../geometry-worker-core.js';
import { computeDrawState, computeOverlayDrawStates } from '../ranges.js';
import type { GeometryChunk } from '../chunks.js';

const tick = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const req = (id: number): GeometryBuildRequest => ({
  id,
  positions: new Float32Array([0, 0, 0, 1, 0, 0]).buffer,
  count: 1,
  radialSegments: 8
});

const reply = (id: number): GeometryBuildResponse => ({
  id,
  positions: new ArrayBuffer(0),
  normals: new ArrayBuffer(0),
  indices: new ArrayBuffer(0),
  vertexSegment: new ArrayBuffer(0),
  vertexCount: 0,
  indicesPerSegment: 0
});

function heldPool() {
  const queue: GeometryBuildRequest[] = [];
  const worker: GeometryWorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: (m) => void queue.push(m),
    terminate: () => undefined
  };
  const pool = new GeometryWorkerPool(1, () => worker);
  return { pool, queue, worker };
}

describe('pool — worker errors are matched to their request', () => {
  it("A's late id-tagged error is dropped; B (same worker) still resolves with its own caller id", async () => {
    const h = heldPool();
    const got: [number, number][] = [];
    const pA = h.pool.buildStreaming([req(11)], (i, r) => got.push([i, r.id]));
    await tick();
    const wireA = h.queue[0].id;
    const pB = h.pool.buildStreaming([req(22)], (i, r) => got.push([i, r.id]));
    await tick();
    expect(h.queue.length).toBe(2);
    const wireB = h.queue[1].id;
    expect(wireB).not.toBe(wireA);
    h.worker.onmessage!({ data: { id: wireA, error: 'A crashed' } satisfies GeometryBuildError });
    h.worker.onmessage!({ data: reply(wireB) });
    await expect(pA).resolves.toBeUndefined();
    await expect(pB).resolves.toBeUndefined();
    expect(got).toEqual([[0, 22]]);
  });

  it("an id-matched error rejects exactly the live request, with the worker's message", async () => {
    const h = heldPool();
    const p = h.pool.buildStreaming([req(5)], () => undefined);
    await tick();
    h.worker.onmessage!({ data: { id: h.queue[0].id, error: 'kernel exploded' } });
    await expect(p).rejects.toThrow('kernel exploded');
  });

  it('a settled request is released: the pool keeps no pending entry after a reply or an error reply', async () => {
    const pending = (p: GeometryWorkerPool): number =>
      (p as unknown as { current: Map<unknown, unknown> }).current.size;
    const ok = heldPool();
    const p1 = ok.pool.buildStreaming([req(1)], () => undefined);
    await tick();
    expect(pending(ok.pool)).toBe(1);
    ok.worker.onmessage!({ data: reply(ok.queue[0].id) });
    await p1;
    expect(pending(ok.pool)).toBe(0);

    const bad = heldPool();
    const p2 = bad.pool.buildStreaming([req(1)], () => undefined);
    await tick();
    bad.worker.onmessage!({ data: { id: bad.queue[0].id, error: 'x' } });
    await expect(p2).rejects.toThrow('x');
    expect(pending(bad.pool)).toBe(0);
  });

  it('a bare worker crash (no id) still fails the live batch', async () => {
    const h = heldPool();
    const p = h.pool.buildStreaming([req(5)], () => undefined);
    await tick();
    h.worker.onerror!(new Error('worker died'));
    await expect(p).rejects.toThrow('worker died');
  });

  it('an unreadable reply (onmessageerror) still fails the live batch', async () => {
    const h = heldPool();
    const p = h.pool.buildStreaming([req(5)], () => undefined);
    await tick();
    h.worker.onmessageerror!('bad clone');
    await expect(p).rejects.toThrow('bad clone');
  });
});

describe('handleGeometryMessage', () => {
  it('turns a kernel throw into {id, error} with the request id and no transfer', () => {
    const { response, transfer } = handleGeometryMessage({ ...req(9), radialSegments: Infinity });
    expect(response).toEqual({
      id: 9,
      error: 'tube.radialSegments must be a whole number in [3, 64] (got Infinity)'
    });
    expect(transfer).toEqual([]);
  });

  it('stringifies a non-Error throw', () => {
    // a null `positions` makes `new Float32Array(null)` fine, but a non-buffer object throws a TypeError (an Error);
    // force a non-Error throw through a getter on the request instead.
    const evil = {
      id: 4,
      get positions(): ArrayBuffer {
        throw 'plain string';
      },
      count: 1,
      radialSegments: 8
    } as unknown as GeometryBuildRequest;
    expect(handleGeometryMessage(evil).response).toEqual({ id: 4, error: 'plain string' });
  });

  it('a good request passes through with its four transferables (control)', () => {
    const { response, transfer } = handleGeometryMessage(req(3));
    expect('error' in response).toBe(false);
    expect(response.id).toBe(3);
    expect(transfer.length).toBe(4);
  });
});

describe('geometry-worker.ts entry', () => {
  it('posts an id-tagged error for a failing request instead of throwing out of onmessage', async () => {
    const g = globalThis as unknown as {
      self: { postMessage: (m: unknown, t?: unknown) => void; onmessage: ((ev: { data: unknown }) => void) | null };
    };
    const posted: unknown[] = [];
    const prev = g.self.postMessage;
    g.self.postMessage = (m) => void posted.push(m);
    try {
      await import('../geometry-worker.js');
      g.self.onmessage!({ data: { ...req(17), radialSegments: NaN } });
      expect(posted).toEqual([{ id: 17, error: 'tube.radialSegments must be a whole number in [3, 64] (got NaN)' }]);
    } finally {
      g.self.postMessage = prev;
      g.self.onmessage = null;
    }
  });
});

describe('computeDrawState — bounds come from ir.segments.layer, not the chunk layer table', () => {
  const irWithLayers = (layer: number[]): ToolpathIR =>
    ({ segments: { layer: Uint16Array.from(layer) } }) as unknown as ToolpathIR;
  const chunk = (layerStart: number, layerEnd: number, count: number): GeometryChunk => ({
    kind: 'extrude',
    layerStart,
    layerEnd,
    count,
    positions: new Float32Array(count * 6),
    segIndices: Uint32Array.from({ length: count }, (_, i) => i)
  });

  it('start: a table that claims the chunk begins after startLayer does not skip the search', () => {
    // table says layers 2..5, the segments actually sit on layers 0,0,1,1
    const s = computeDrawState(irWithLayers([0, 0, 1, 1]), chunk(2, 5, 4), 1, 9);
    expect(s).toEqual({ visible: true, drawStart: 2, drawCount: 2 });
  });

  it('end: a table that claims the chunk ends before endLayer does not skip the search', () => {
    // table says layers 0..0, the segments actually sit on layers 0,0,1,1
    const s = computeDrawState(irWithLayers([0, 0, 1, 1]), chunk(0, 0, 4), 0, 0);
    expect(s).toEqual({ visible: true, drawStart: 0, drawCount: 2 });
    const t = computeDrawState(irWithLayers([0, 0, 1, 1]), chunk(0, 0, 4), 0, 0 + 5);
    expect(t).toEqual({ visible: true, drawStart: 0, drawCount: 4 });
  });

  it('end: a table ending BELOW endLayer does not skip the search when the real layers run past it', () => {
    // table says layers 0..0 (< endLayer 1), the segments actually sit on layers 0,0,2,2
    const s = computeDrawState(irWithLayers([0, 0, 2, 2]), chunk(0, 0, 4), 0, 1);
    expect(s).toEqual({ visible: true, drawStart: 0, drawCount: 2 });
  });

  it('a consistent chunk still draws whole (control)', () => {
    expect(computeDrawState(irWithLayers([1, 1, 2, 2]), chunk(1, 2, 4), 1, 2)).toEqual({
      visible: true,
      drawStart: 0,
      drawCount: 4
    });
  });

  it('overlay splits use the same layer-derived bounds', () => {
    const o = computeOverlayDrawStates(irWithLayers([0, 0, 1, 1]), chunk(2, 5, 4), 1, 9, 2, 2);
    expect(o.completed).toEqual({ visible: true, drawStart: 2, drawCount: 1 });
    expect(o.ghost).toEqual({ visible: true, drawStart: 3, drawCount: 1 });
  });
});

describe('setQualityMode validation', () => {
  function make(): ToolpathRenderer {
    const canvas = document.createElement('canvas');
    const stub: GLRendererLike = {
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
    };
    return new ToolpathRenderer({
      canvas,
      quality: 'lines',
      createRenderer: () => stub,
      scheduleFrame: () => undefined
    });
  }

  it('throws synchronously for an unknown mode, naming the option, and the previous mode stays', () => {
    const r = make();
    r.setQualityMode('fast');
    expect(() => r.setQualityMode('bogus' as never)).toThrow(
      "qualityMode must be 'full', 'adaptive' or 'fast' (got bogus)"
    );
    expect((r as unknown as { qualityMode: string }).qualityMode).toBe('fast');
    expect(() => r.setQualityMode(undefined as never)).toThrow('qualityMode must be');
    expect(() => r.setQualityMode(null as never)).toThrow('(got null)');
    expect((r as unknown as { qualityMode: string }).qualityMode).toBe('fast');
    r.dispose();
  });

  it('accepts the three valid modes (control)', () => {
    const r = make();
    for (const m of ['full', 'adaptive', 'fast'] as const) {
      r.setQualityMode(m);
      expect((r as unknown as { qualityMode: string }).qualityMode).toBe(m);
    }
    r.dispose();
  });
});
