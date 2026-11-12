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

  it('dispose() mid-build settles buildStreaming instead of hanging (regression)', async () => {
    // Workers that never reply — every pump parks on its in-flight dispatch. Before the fix, dispose()
    // dropped those parked promises and Promise.all never settled, hanging the build coroutine forever.
    const stalling = (): GeometryWorkerLike => ({ onmessage: null, postMessage() {}, terminate() {} });
    const pool = new GeometryWorkerPool(2, stalling);
    const ir = makeIR(4, 20);
    const reqs = buildChunks(ir, { decimation: 1, targetSegmentsPerChunk: 20 })
      .chunks.filter((c) => c.kind === 'extrude')
      .map((c, i) => reqFromChunk(c, i, 8));
    expect(reqs.length).toBeGreaterThan(0);
    let settled = false;
    const done = pool
      .buildStreaming(reqs, () => undefined)
      .then(() => {
        settled = true;
      });
    await Promise.resolve(); // let the pumps park on the never-answering workers
    pool.dispose();
    await done; // must resolve, not hang (vitest would otherwise time out)
    expect(settled).toBe(true);
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

/** A worker the test answers by hand: records requests, replies only when told to. */
function manualWorker(
  log: GeometryBuildRequest[]
): GeometryWorkerLike & { reply(id: number, vertexCount: number): void } {
  const w: GeometryWorkerLike & { reply(id: number, vertexCount: number): void } = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(msg: GeometryBuildRequest) {
      log.push(msg);
    },
    terminate() {},
    reply(id, vertexCount) {
      const empty = new ArrayBuffer(0);
      w.onmessage?.({
        data: {
          id,
          positions: empty,
          normals: empty,
          indices: empty,
          vertexSegment: empty,
          vertexCount,
          indicesPerSegment: 0
        }
      });
    }
  };
  return w;
}

const bareReq = (id: number): GeometryBuildRequest => ({
  id,
  positions: new ArrayBuffer(24),
  count: 1,
  radialSegments: 8
});

describe('GeometryWorkerPool: overlapping builds and failures (sweep)', () => {
  it("a rebuild on the same pool never receives the previous build's reply; the old run stops cleanly", async () => {
    const log: GeometryBuildRequest[] = [];
    const w = manualWorker(log);
    const pool = new GeometryWorkerPool(1, () => w);
    const oldGot: number[] = [];
    const newGot: Array<[number, number, number]> = [];
    const oldRun = pool.buildStreaming([bareReq(0), bareReq(1)], (i) => oldGot.push(i));
    await Promise.resolve();
    expect(log).toHaveLength(1);
    const newRun = pool.buildStreaming([bareReq(0), bareReq(1)], (i, r) => newGot.push([i, r.id, r.vertexCount]));
    await oldRun; // superseded: resolves, does not hang
    expect(log).toHaveLength(2); // the new run dispatched its own first request
    const [staleWire, liveWire] = [log[0].id, log[1].id];
    expect(staleWire).not.toBe(liveWire);
    w.reply(staleWire, 111); // the old request finally answers: must be dropped
    expect(newGot).toEqual([]);
    w.reply(liveWire, 222);
    await Promise.resolve();
    await Promise.resolve();
    expect(newGot).toEqual([[0, 0, 222]]); // index 0, caller id 0, the NEW build's data
    w.reply(log[2].id, 333);
    await newRun;
    expect(newGot).toEqual([
      [0, 0, 222],
      [1, 1, 333]
    ]);
    expect(oldGot).toEqual([]);
  });

  it('after one worker fails, sibling workers deliver nothing more and the run rejects', async () => {
    const logA: GeometryBuildRequest[] = [];
    const logB: GeometryBuildRequest[] = [];
    const wa = manualWorker(logA);
    const wb = manualWorker(logB);
    const ws = [wa, wb];
    const pool = new GeometryWorkerPool(2, () => ws.shift() as GeometryWorkerLike);
    const got: number[] = [];
    const run = pool.buildStreaming([bareReq(0), bareReq(1), bareReq(2), bareReq(3)], (i) => got.push(i));
    const outcome = run.then(
      () => 'resolved',
      (e: Error) => e.message
    );
    await Promise.resolve();
    wa.onerror?.(new Error('worker A crashed'));
    expect(await outcome).toBe('worker A crashed');
    wb.reply(logB[0].id, 5); // B answers after the failure: must not be delivered, must not pull more work
    await Promise.resolve();
    await Promise.resolve();
    expect(got).toEqual([]);
    expect(logB).toHaveLength(1);
    expect(logA).toHaveLength(1);
  });

  it('a reply that cannot be deserialised (messageerror) rejects instead of hanging', async () => {
    const w = manualWorker([]);
    const pool = new GeometryWorkerPool(1, () => w);
    const run = pool.buildStreaming([bareReq(0)], () => undefined);
    await Promise.resolve();
    w.onmessageerror?.(new Error('cannot clone reply'));
    await expect(run).rejects.toThrow('cannot clone reply');
  });

  it("the response keeps the caller's request id, not the pool's wire id", async () => {
    const log: GeometryBuildRequest[] = [];
    const w = manualWorker(log);
    const pool = new GeometryWorkerPool(1, () => w);
    const seen: number[] = [];
    const run = pool.buildStreaming([bareReq(41)], (_i, r) => seen.push(r.id));
    await Promise.resolve();
    w.reply(log[0].id, 1);
    await run;
    expect(seen).toEqual([41]);
  });

  it('a run superseded from inside onResult dispatches nothing more (loop-top liveness)', async () => {
    const log: GeometryBuildRequest[] = [];
    const w = manualWorker(log);
    const pool = new GeometryWorkerPool(1, () => w);
    let newRun: Promise<void> | null = null;
    const oldRun = pool.buildStreaming([bareReq(0), bareReq(1)], (i) => {
      if (i === 0) newRun = pool.buildStreaming([bareReq(9)], () => undefined);
    });
    await Promise.resolve();
    w.reply(log[0].id, 1); // old request 0 answers -> onResult supersedes the run with a new one
    await oldRun; // the old run stops cleanly
    expect(log).toHaveLength(2); // old0 + new0; the old run's request 1 was never sent
    w.reply(log[1].id, 2);
    await newRun;
  });

  it('dispose() terminates every worker exactly once', () => {
    let terminated = 0;
    const mk = (): GeometryWorkerLike => ({ onmessage: null, postMessage() {}, terminate: () => void terminated++ });
    const pool = new GeometryWorkerPool(3, mk);
    pool.dispose();
    expect(terminated).toBe(3);
  });

  it('a size-0 pool still creates one worker (a pool is never empty)', () => {
    let created = 0;
    const pool = new GeometryWorkerPool(0, () => {
      created++;
      return { onmessage: null, postMessage() {}, terminate() {} };
    });
    expect(created).toBe(1);
    pool.dispose();
  });

  it('resolvePoolSize: a 0, negative or non-finite core budget falls back to 1 worker', () => {
    expect(resolvePoolSize(0)).toBe(1);
    expect(resolvePoolSize(-4)).toBe(1);
    expect(resolvePoolSize(Number.POSITIVE_INFINITY)).toBe(1);
    expect(resolvePoolSize(2.9)).toBe(1);
    expect(resolvePoolSize(3)).toBe(2);
  });
});
