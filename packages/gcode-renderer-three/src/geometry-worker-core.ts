/**
 * Geometry worker kernel — the host-agnostic core of the DD-028 worker pool.
 *
 * A tube chunk is self-contained (RR-008 §4.1 / DD-028): the only input the kernel needs is the chunk's
 * interleaved endpoint buffer (`positions`, 6 floats/segment) + its segment `count`. So a chunk crosses
 * a worker boundary as a single transferable `ArrayBuffer`, with no `ToolpathIR` and no `SharedArrayBuffer`.
 * This module is pure and `three`-free — the same `handleGeometryRequest` runs in a browser Web Worker
 * (`geometry-worker.ts`) and in a Node `worker_threads` worker (the measurement harness), so the parallel
 * build is measured and shipped against one kernel.
 */
import { buildTubeChunk } from './tubes.js';
import type { GeometryChunk } from './chunks.js';

/** Request: build one tube chunk. `positions` is transferred (main thread keeps its own copy). */
export interface GeometryBuildRequest {
  /** Correlates the response; the pool also uses it to place the result in deterministic chunk order. */
  id: number;
  /** Interleaved segment endpoints (x0,y0,z0,x1,y1,z1 per segment) — the transferable payload. */
  positions: ArrayBuffer;
  /** Segments in the chunk. */
  count: number;
  radialSegments: number;
  lineWidth?: number;
  lineHeight?: number;
}

/** Response: the built tube geometry buffers, all transferred back. */
export interface GeometryBuildResponse {
  id: number;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  indices: ArrayBuffer;
  vertexSegment: ArrayBuffer;
  vertexCount: number;
  indicesPerSegment: number;
}

/**
 * Run the tube kernel on a self-contained chunk payload (pure; host-agnostic). Returns the response plus
 * the list of `ArrayBuffer`s to transfer. Byte-identical to the inline `buildTubeChunk` — it *is* the
 * same kernel, fed the same `positions`.
 */
export function handleGeometryRequest(req: GeometryBuildRequest): {
  response: GeometryBuildResponse;
  transfer: ArrayBuffer[];
} {
  const positions = new Float32Array(req.positions);
  // The kernel reads only `positions` + `count` (segIndices is unused after RR-008 Phase 1); a bare
  // Uint32Array satisfies the GeometryChunk shape without carrying the index buffer across the boundary.
  const chunk: GeometryChunk = {
    kind: 'extrude',
    layerStart: 0,
    layerEnd: 0,
    count: req.count,
    positions,
    segIndices: new Uint32Array(0)
  };
  const tube = buildTubeChunk(chunk, {
    radialSegments: req.radialSegments,
    lineWidth: req.lineWidth,
    lineHeight: req.lineHeight
  });
  const response: GeometryBuildResponse = {
    id: req.id,
    positions: tube.positions.buffer as ArrayBuffer,
    normals: tube.normals.buffer as ArrayBuffer,
    indices: tube.indices.buffer as ArrayBuffer,
    vertexSegment: tube.vertexSegment.buffer as ArrayBuffer,
    vertexCount: tube.vertexCount,
    indicesPerSegment: tube.indicesPerSegment
  };
  return {
    response,
    transfer: [response.positions, response.normals, response.indices, response.vertexSegment]
  };
}
