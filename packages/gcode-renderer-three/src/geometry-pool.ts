/**
 * Bounded geometry worker pool (DD-028). Builds tube chunks across a small set of workers and returns
 * the results in **deterministic chunk order** (regardless of completion order), so the assembled scene
 * is byte-identical to a serial build. Capability-aware sizing; the worker is injectable so tests use a
 * synchronous fake and Node uses a `worker_threads` adapter. Memory-aware backpressure and the renderer
 * wiring land in the follow-up phase; this module is the measurable core.
 */
import type { GeometryBuildError, GeometryBuildRequest, GeometryBuildResponse } from './geometry-worker-core.js';

/** Minimal duck-typed worker surface the pool drives (a Web Worker, a worker_threads shim, or a fake). */
export interface GeometryWorkerLike {
  postMessage(msg: GeometryBuildRequest, transfer?: ArrayBuffer[]): void;
  onmessage: ((ev: { data: GeometryBuildResponse | GeometryBuildError }) => void) | null;
  onerror?: ((err: unknown) => void) | null;
  /** A reply that could not be deserialised: the request will never be answered, so it must reject. */
  onmessageerror?: ((err: unknown) => void) | null;
  terminate(): void;
}

/**
 * Capability-aware pool size (DD-028 D3): `clamp(coreBudget - 1, 1, max)`. `coreBudget` is
 * `navigator.hardwareConcurrency` in the browser; a Node/sidecar caller passes the **cgroup quota**, not
 * `os.cpus().length` (see DD-028 §7 — a quota-limited container over-reports host cores). An
 * unknown/invalid core count falls back conservatively.
 */
/**
 * The batteries-included browser Web Worker factory (DD-028). A bundler resolves `./geometry-worker.js`
 * relative to this module (the same pattern the parser worker uses). Pass it as `createGeometryWorker`
 * (core wires it by default in a browser); a consumer with an exotic host can inject their own.
 */
export function createBrowserGeometryWorker(): GeometryWorkerLike {
  return new Worker(new URL('./geometry-worker.js', import.meta.url), {
    type: 'module'
  }) as unknown as GeometryWorkerLike;
}

export function resolvePoolSize(coreBudget: number | undefined, max = 8): number {
  const cores = typeof coreBudget === 'number' && Number.isFinite(coreBudget) ? Math.floor(coreBudget) : 2;
  return Math.max(1, Math.min(max, cores - 1));
}

interface Pending {
  /** Pool-unique id sent on the wire; a reply is accepted only if it carries exactly this id. */
  wireId: number;
  /** The caller's own request id, restored on the response. */
  callerId: number;
  resolve: (r: GeometryBuildResponse) => void;
  reject: (err: unknown) => void;
}

export class GeometryWorkerPool {
  private readonly workers: GeometryWorkerLike[] = [];
  /** Per-worker settler for its single in-flight request (a worker builds one chunk at a time). */
  private readonly current = new Map<GeometryWorkerLike, Pending>();
  private disposed = false;
  /** Bumped by every `buildStreaming`; a run whose epoch is no longer current has been superseded. */
  private epoch = 0;
  private wireSeq = 0;

  constructor(
    readonly size: number,
    createWorker: () => GeometryWorkerLike
  ) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const w = createWorker();
      w.onmessage = (ev) => {
        const p = this.current.get(w);
        // A reply for a request that is no longer the worker's live one (its build was superseded) must not
        // settle the live request: it would hand the old build's geometry to the new build's chunk.
        if (p === undefined || ev.data.id !== p.wireId) return;
        this.current.delete(w);
        // An id-matched kernel failure rejects exactly the request it answers; a stale one was dropped above.
        if ('error' in ev.data) p.reject(new Error(ev.data.error));
        else p.resolve({ ...ev.data, id: p.callerId });
      };
      const fail = (err: unknown): void => {
        const p = this.current.get(w);
        this.current.delete(w);
        p?.reject(err instanceof Error ? err : new Error(String(err)));
      };
      w.onerror = fail;
      w.onmessageerror = fail;
      this.workers.push(w);
    }
  }

  /** Dispatch one request to one worker; settles when that worker replies or errors. */
  private dispatch(worker: GeometryWorkerLike, req: GeometryBuildRequest): Promise<GeometryBuildResponse> {
    return new Promise((resolve, reject) => {
      const wireId = ++this.wireSeq;
      this.current.set(worker, { wireId, callerId: req.id, resolve, reject });
      worker.postMessage({ ...req, id: wireId }, [req.positions]);
    });
  }

  /**
   * Stream builds across the pool with backpressure (at most `size` in flight — each worker pulls the
   * next index only when its previous chunk returns), invoking `onResult(index, response)` as each
   * completes. Memory-friendly: the caller uploads + drops each response immediately, so peak transient
   * geometry is bounded by `size` (not the whole batch). Rejects on the first worker error; resolves
   * when every request has been delivered (or the pool was disposed mid-run).
   */
  async buildStreaming(
    requests: GeometryBuildRequest[],
    onResult: (index: number, response: GeometryBuildResponse) => void
  ): Promise<void> {
    // A new run supersedes any run still in flight on this pool (a rebuild while the previous build is
    // mid-air): reject its pending requests so it stops cleanly, and let its late replies be ignored.
    const epoch = ++this.epoch;
    for (const p of this.current.values()) p.reject(new Error('E_POOL_SUPERSEDED: a newer geometry build took over'));
    this.current.clear();
    let next = 0;
    let failed = false;
    const live = (): boolean => !this.disposed && epoch === this.epoch && !failed;
    const pump = async (worker: GeometryWorkerLike): Promise<void> => {
      while (live()) {
        const i = next++;
        if (i >= requests.length) return;
        let response: GeometryBuildResponse;
        try {
          response = await this.dispatch(worker, requests[i]);
        } catch (err) {
          // dispose() / a superseding run rejects the in-flight request so this await unblocks (a terminated
          // worker fires no message/error of its own). Treat that as a clean stop; re-throw a genuine worker
          // error so the batch fails fast — and stop the sibling pumps so nothing is delivered after it.
          if (this.disposed || epoch !== this.epoch) return;
          failed = true;
          throw err;
        }
        if (!live()) return;
        onResult(i, response);
      }
    };
    await Promise.all(this.workers.map((w) => pump(w)));
  }

  /**
   * Build every request and return responses in **input order**. Convenience over {@link buildStreaming}
   * for callers that want the whole batch (holds all responses — not memory-bounded; the renderer uses
   * the streaming form). A `null` slot means the build was skipped (disposed mid-run).
   */
  async buildAll(requests: GeometryBuildRequest[]): Promise<(GeometryBuildResponse | null)[]> {
    const results: (GeometryBuildResponse | null)[] = new Array(requests.length).fill(null);
    await this.buildStreaming(requests, (i, r) => {
      results[i] = r;
    });
    return results;
  }

  dispose(): void {
    this.disposed = true;
    // Reject every in-flight request BEFORE terminating: a terminated worker fires no message/error, so
    // any `pump` parked at `await dispatch(...)` would otherwise never settle and `buildStreaming` would
    // hang forever (leaking its coroutine + closures). pump swallows this rejection when disposed.
    for (const p of this.current.values()) p.reject(new Error('E_POOL_DISPOSED: geometry pool disposed mid-build'));
    this.current.clear();
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }
}
