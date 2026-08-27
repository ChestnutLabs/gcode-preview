/**
 * DD-028 — the geometry worker pool: byte-identical to a serial build, results in deterministic chunk
 * order, capability-aware sizing. Uses a synchronous fake worker (runs the real kernel inline via a
 * microtask) so the pool logic is exercised without real threads.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { buildChunks, buildTubeChunk } from '../index.js';
import { GeometryWorkerPool, resolvePoolSize, type GeometryWorkerLike } from '../geometry-pool.js';
import { handleGeometryRequest, type GeometryBuildRequest } from '../geometry-worker-core.js';

function makeIR(layers: number, perLayer: number): ToolpathIR {
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

/** A fake worker that runs the real kernel and replies on a microtask (async, like a real worker). */
function syncWorker(): GeometryWorkerLike {
  const w: GeometryWorkerLike = {
    onmessage: null,
    postMessage(msg: GeometryBuildRequest) {
      const { response } = handleGeometryRequest(msg);
      queueMicrotask(() => w.onmessage?.({ data: response }));
    },
    terminate() {}
  };
  return w;
}

function reqFromChunk(
  chunk: { positions: Float32Array; count: number },
  id: number,
  radialSegments: number
): GeometryBuildRequest {
  // Copy the buffer (a real worker transfers it away; the serial reference keeps the chunk intact).
  return { id, positions: chunk.positions.buffer.slice(0), count: chunk.count, radialSegments };
}

describe('resolvePoolSize (DD-028)', () => {
  it('clamps to coreBudget-1 within [1, max]; conservative on unknown', () => {
    expect(resolvePoolSize(8)).toBe(7);
    expect(resolvePoolSize(8, 4)).toBe(4); // max wins
    expect(resolvePoolSize(2)).toBe(1); // 2-core container → 1 build worker (never oversubscribe)
    expect(resolvePoolSize(1)).toBe(1); // floor at 1
    expect(resolvePoolSize(undefined)).toBe(1); // unknown → conservative (2 cores → 1)
    expect(resolvePoolSize(0)).toBe(1);
  });
});

describe('GeometryWorkerPool (DD-028)', () => {
  it('produces byte-identical geometry to a serial build, in deterministic chunk order', async () => {
    const ir = makeIR(8, 40);
    const built = buildChunks(ir, { decimation: 1, targetSegmentsPerChunk: 30 }); // one chunk per layer
    const extrude = built.chunks.filter((c) => c.kind === 'extrude');
    expect(extrude.length).toBeGreaterThan(3); // genuinely multi-chunk (more chunks than workers)

    // Serial reference.
    const serial = extrude.map((c) => buildTubeChunk(c, { radialSegments: 8 }));

    // Parallel via the pool (3 workers).
    const pool = new GeometryWorkerPool(3, syncWorker);
    const requests = extrude.map((c, i) => reqFromChunk(c, i, 8));
    const responses = await pool.buildAll(requests);
    pool.dispose();

    expect(responses).toHaveLength(extrude.length);
    for (let i = 0; i < extrude.length; i++) {
      const r = responses[i]!;
      expect(r).not.toBeNull();
      // Deterministic order: response i corresponds to chunk i.
      expect(r.id).toBe(i);
      // Byte-identical geometry.
      expect(new Float32Array(r.positions)).toEqual(serial[i].positions);
      expect(new Float32Array(r.normals)).toEqual(serial[i].normals);
      expect(new Uint32Array(r.indices)).toEqual(serial[i].indices);
      expect(new Uint32Array(r.vertexSegment)).toEqual(serial[i].vertexSegment);
      expect(r.vertexCount).toBe(serial[i].vertexCount);
      expect(r.indicesPerSegment).toBe(serial[i].indicesPerSegment);
    }
  });

  it('handles a single-worker pool and an empty request list', async () => {
    const pool = new GeometryWorkerPool(1, syncWorker);
    expect(await pool.buildAll([])).toEqual([]);
    const ir = makeIR(2, 10);
    const chunk = buildChunks(ir, { decimation: 1 }).chunks.find((c) => c.kind === 'extrude')!;
    const [res] = await pool.buildAll([reqFromChunk(chunk, 0, 8)]);
    expect(res?.vertexCount).toBe(buildTubeChunk(chunk, { radialSegments: 8 }).vertexCount);
    pool.dispose();
  });
});
