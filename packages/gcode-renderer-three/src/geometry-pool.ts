/**
 * Bounded geometry worker pool (DD-028). Builds tube chunks across a small set of workers and returns
 * the results in **deterministic chunk order** (regardless of completion order), so the assembled scene
 * is byte-identical to a serial build. Capability-aware sizing; the worker is injectable so tests use a
 * synchronous fake and Node uses a `worker_threads` adapter. Memory-aware backpressure and the renderer
 * wiring land in the follow-up phase; this module is the measurable core.
 */
import type { GeometryBuildRequest, GeometryBuildResponse } from './geometry-worker-core.js';

/** Minimal duck-typed worker surface the pool drives (a Web Worker, a worker_threads shim, or a fake). */
export interface GeometryWorkerLike {
  postMessage(msg: GeometryBuildRequest, transfer?: ArrayBuffer[]): void;
  onmessage: ((ev: { data: GeometryBuildResponse }) => void) | null;
  onerror?: ((err: unknown) => void) | null;
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
  const cores =
    typeof coreBudget === 'number' && Number.isFinite(coreBudget) && coreBudget > 0 ? Math.floor(coreBudget) : 2;
  return Math.max(1, Math.min(max, cores - 1));
}

interface Pending {
  resolve: (r: GeometryBuildResponse) => void;
  reject: (err: unknown) => void;
}

export class GeometryWorkerPool {
  private readonly workers: GeometryWorkerLike[] = [];
  /** Per-worker settler for its single in-flight request (a worker builds one chunk at a time). */
  private readonly current = new Map<GeometryWorkerLike, Pending>();
  private disposed = false;

  constructor(
    readonly size: number,
    createWorker: () => GeometryWorkerLike
  ) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const w = createWorker();
      w.onmessage = (ev) => {
        const p = this.current.get(w);
        this.current.delete(w);
        p?.resolve(ev.data);
      };
      w.onerror = (err) => {
        const p = this.current.get(w);
        this.current.delete(w);
        p?.reject(err instanceof Error ? err : new Error(String(err)));
      };
      this.workers.push(w);
    }
  }

  /** Dispatch one request to one worker; settles when that worker replies or errors. */
  private dispatch(worker: GeometryWorkerLike, req: GeometryBuildRequest): Promise<GeometryBuildResponse> {
    return new Promise((resolve, reject) => {
      this.current.set(worker, { resolve, reject });
      worker.postMessage(req, [req.positions]);
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
    let next = 0;
    const pump = async (worker: GeometryWorkerLike): Promise<void> => {
      while (!this.disposed) {
        const i = next++;
        if (i >= requests.length) return;
        const response = await this.dispatch(worker, requests[i]);
        if (this.disposed) return;
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
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.current.clear();
  }
}
