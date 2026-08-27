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
export function resolvePoolSize(coreBudget: number | undefined, max = 8): number {
  const cores =
    typeof coreBudget === 'number' && Number.isFinite(coreBudget) && coreBudget > 0 ? Math.floor(coreBudget) : 2;
  return Math.max(1, Math.min(max, cores - 1));
}

export class GeometryWorkerPool {
  private readonly workers: GeometryWorkerLike[] = [];
  /** Per-worker resolver for its single in-flight request (a worker builds one chunk at a time). */
  private readonly current = new Map<GeometryWorkerLike, (r: GeometryBuildResponse) => void>();
  private disposed = false;

  constructor(
    readonly size: number,
    createWorker: () => GeometryWorkerLike
  ) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const w = createWorker();
      w.onmessage = (ev) => {
        const resolve = this.current.get(w);
        this.current.delete(w);
        resolve?.(ev.data);
      };
      this.workers.push(w);
    }
  }

  /** Dispatch one request to one worker; resolves when that worker replies. */
  private dispatch(worker: GeometryWorkerLike, req: GeometryBuildRequest): Promise<GeometryBuildResponse> {
    return new Promise((resolve) => {
      this.current.set(worker, resolve);
      worker.postMessage(req, [req.positions]);
    });
  }

  /**
   * Build every request across the pool with backpressure (at most `size` in flight — each worker pulls
   * the next index only when its previous chunk returns), and return responses in the **input order**.
   * A `null` slot means the build was skipped (disposed mid-run).
   */
  async buildAll(requests: GeometryBuildRequest[]): Promise<(GeometryBuildResponse | null)[]> {
    const results: (GeometryBuildResponse | null)[] = new Array(requests.length).fill(null);
    let next = 0;
    const pump = async (worker: GeometryWorkerLike): Promise<void> => {
      while (!this.disposed) {
        const i = next++;
        if (i >= requests.length) return;
        results[i] = await this.dispatch(worker, requests[i]);
      }
    };
    await Promise.all(this.workers.map((w) => pump(w)));
    return results;
  }

  dispose(): void {
    this.disposed = true;
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.current.clear();
  }
}
