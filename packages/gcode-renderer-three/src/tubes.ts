/**
 * Tube-profile geometry for `tubes` quality mode (DD-004 §4.3, phase 4, issue #59).
 *
 * PROVENANCE (fork/license policy §6): the cross-section math — corner-averaged
 * tangents, smallest-axis normal selection, the elliptical lineWidth/lineHeight
 * ring formula, and the ring-pair index topology — is ported from the inherited
 * `src/extrusion-geometry.ts` (xyz-tools/gcode-preview @ 15375e56, MIT). Recorded
 * in docs/UPSTREAM_PROVENANCE.md. Deliberate adaptations, not behavior drift:
 *   - builds flat typed arrays for a whole chunk (many polylines batched into one
 *     indexed geometry) instead of one BufferGeometry per path;
 *   - drops the UV attribute (untextured) and the inherited trailing duplicate
 *     ring (it was never referenced by the index buffer);
 *   - emits indices in chunk-local segment order, so every segment owns exactly
 *     `6 * radialSegments` indices — `drawRange` clips tubes per segment exactly,
 *     the same §4.5 contract as lines mode.
 *
 * Pure typed-array module: no three.js import (the scene layer wraps the output
 * in BufferGeometry), fully testable in Node — same stance as chunks.ts.
 */
import type { GeometryChunk } from './chunks.js';

export interface TubeOptions {
  /** Extrusion width in mm (inherited default 0.6). */
  lineWidth?: number;
  /** Extrusion (layer) height in mm (inherited default 0.2). */
  lineHeight?: number;
  /** Ring subdivisions (inherited default 8). */
  radialSegments?: number;
  /** Vertex budget per chunk; exceeding it throws RangeError (fallback path, §6.1). */
  maxVertices?: number;
}

export interface TubeChunkGeometry {
  /** Ring vertex positions, origin-relative like the IR (3 floats/vertex). */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Chunk-local segment ordinal per vertex (color mapping). */
  vertexSegment: Uint32Array;
  /** Every segment owns exactly this many indices — drawRange unit (§4.5). */
  indicesPerSegment: number;
  vertexCount: number;
}

/** §4.3 provisional `auto` threshold: tubes at or below, lines above (ratified in #61). */
export const TUBES_AUTO_MAX_SEGMENTS = 1_000_000;

const DEFAULT_MAX_VERTICES = 8_000_000;

/** Minimum tube cross-section sides — below this a tube isn't a tube; degrade to lines instead. */
export const MIN_RADIAL_SEGMENTS = 3;

/** Upper bound for the tube cross-section: beyond this a ring is sub-pixel and only burns memory. */
export const MAX_RADIAL_SEGMENTS = 64;

// `Number.isInteger` / `Number.isFinite` are already false for any non-number, so no `typeof` guard is needed.
const isWhole = (n: unknown, min: number, max: number): n is number =>
  Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
const isPositiveFinite = (n: unknown): n is number => Number.isFinite(n) && (n as number) > 0;

/**
 * Validate consumer-supplied tube options. `undefined` keeps the default; anything else out of range throws
 * a `RangeError` naming the option and its accepted range (never clamped): NaN, ±Infinity, fractions and
 * negatives. A non-finite `radialSegments` used to hang `tubeRadialForBudget` forever; a fractional one
 * produced a corrupt, half-vertex geometry.
 */
export function checkTubeOptions(tube: TubeOptions | undefined): void {
  if (tube === undefined) return;
  const { radialSegments, lineWidth, lineHeight, maxVertices } = tube;
  if (radialSegments !== undefined && !isWhole(radialSegments, MIN_RADIAL_SEGMENTS, MAX_RADIAL_SEGMENTS)) {
    throw new RangeError(
      `tube.radialSegments must be a whole number in [${MIN_RADIAL_SEGMENTS}, ${MAX_RADIAL_SEGMENTS}] (got ${String(radialSegments)})`
    );
  }
  if (lineWidth !== undefined && !isPositiveFinite(lineWidth)) {
    throw new RangeError(`tube.lineWidth must be a finite number > 0 (got ${String(lineWidth)})`);
  }
  if (lineHeight !== undefined && !isPositiveFinite(lineHeight)) {
    throw new RangeError(`tube.lineHeight must be a finite number > 0 (got ${String(lineHeight)})`);
  }
  if (maxVertices !== undefined && !isWhole(maxVertices, 1, Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`tube.maxVertices must be a whole number >= 1 (got ${String(maxVertices)})`);
  }
}

/** A quality policy must be exactly `'full'`, `'adaptive'` or `'fast'` (no `undefined` here: a setter needs a value). */
export function checkQualityMode(q: unknown): void {
  if (q !== 'full' && q !== 'adaptive' && q !== 'fast') {
    throw new RangeError(`qualityMode must be 'full', 'adaptive' or 'fast' (got ${String(q)})`);
  }
}

/** Validate the renderer's tube/pool budget options (same policy as {@link checkTubeOptions}). */
export function checkBudgetOptions(opts: {
  tubeByteBudget?: number;
  geometryMemoryBudgetBytes?: number;
  geometryConcurrency?: 'auto' | 'off' | number;
  qualityMode?: string;
}): void {
  if (opts.qualityMode !== undefined) checkQualityMode(opts.qualityMode);
  if (opts.tubeByteBudget !== undefined && !isPositiveFinite(opts.tubeByteBudget)) {
    throw new RangeError(`tubeByteBudget must be a finite number > 0 (got ${String(opts.tubeByteBudget)})`);
  }
  if (opts.geometryMemoryBudgetBytes !== undefined && !isPositiveFinite(opts.geometryMemoryBudgetBytes)) {
    throw new RangeError(
      `geometryMemoryBudgetBytes must be a finite number > 0 (got ${String(opts.geometryMemoryBudgetBytes)})`
    );
  }
  const c = opts.geometryConcurrency;
  if (c !== undefined && c !== 'auto' && c !== 'off' && !isWhole(c, 1, Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`geometryConcurrency must be 'auto', 'off' or a whole number >= 1 (got ${String(c)})`);
  }
}

/**
 * CPU-side bytes one tube segment costs at `radialSegments` sides (RR-006 accounting): a ring of
 * `radialSegments + 1` vertices carrying position + normal + vertexSegment + colour, plus
 * `radialSegments * 6` indices. Used to size the memory budget below.
 */
export function tubeSegmentBytes(radialSegments: number): number {
  return (radialSegments + 1) * (12 + 12 + 4 + 12) + radialSegments * 6 * 4;
}

/**
 * Default CPU byte budget for a tube build (RR-006). ~450 MB CPU → ~900 MB peak once three uploads a
 * second copy to the GPU — comfortably inside a 2 GB render cgroup with base-heap + source headroom.
 */
export const TUBE_CPU_BYTE_BUDGET = 450_000_000;

/**
 * Pick the tube cross-section resolution for a large file (DD-022 / RR-006 correction). Bounding tube
 * memory by **dropping segments** shreds the tube (each survivor becomes a disconnected capped stub →
 * spikes); the right lever is a **coarser cross-section** at full segment continuity. Returns the largest
 * `radialSegments` in `[MIN_RADIAL_SEGMENTS, requested]` whose whole-build cost fits `byteBudget`, or
 * `null` when even the minimum does not — the caller then falls back to flat lines (honest, continuous).
 */
export function tubeRadialForBudget(
  segmentCount: number,
  requested: number,
  byteBudget = TUBE_CPU_BYTE_BUDGET
): number | null {
  // Validate BEFORE the loop: an Infinity `requested` never terminates, a fraction yields a fractional ring.
  checkTubeOptions({ radialSegments: requested });
  // Start from the validated range's ceiling, not `requested` itself: if the guard above were ever lost, an
  // Infinity `requested` would spin a synchronous loop no test runner can interrupt.
  for (let r = Math.min(requested, MAX_RADIAL_SEGMENTS); r >= MIN_RADIAL_SEGMENTS; r--) {
    if (segmentCount * tubeSegmentBytes(r) <= byteBudget) return r;
  }
  // `requested` is validated >= MIN_RADIAL_SEGMENTS, so the loop above already tried the minimum cross-section.
  return null;
}

/**
 * Split a chunk's included segments into connected polylines: a new run starts
 * whenever the previous segment's end is not this segment's start. Reads only
 * `chunk.positions` (6 floats/seg: x0,y0,z0,x1,y1,z1) — the same Float32 values
 * `chunks.ts` copied verbatim from the IR, so exact comparison is sound AND the
 * chunk is fully self-contained (no IR reference), the enabler for building a
 * chunk on a worker thread (DD-026 successor RR-008 §4.1).
 */
function findPolylines(chunk: GeometryChunk): number[] {
  const pos = chunk.positions;
  const starts: number[] = [];
  for (let k = 0; k < chunk.count; k++) {
    if (k === 0) {
      starts.push(0);
      continue;
    }
    const prevEnd = (k - 1) * 6 + 3; // previous segment's end point (x1,y1,z1)
    const curStart = k * 6; // this segment's start point (x0,y0,z0)
    if (
      pos[prevEnd] !== pos[curStart] ||
      pos[prevEnd + 1] !== pos[curStart + 1] ||
      pos[prevEnd + 2] !== pos[curStart + 2]
    ) {
      starts.push(k);
    }
  }
  return starts;
}

/**
 * Build tube geometry for one chunk. Reads ONLY `chunk.positions` (self-contained, no IR) so a chunk
 * can be handed to a worker as a single transferable buffer (RR-008 §4.1) — output is byte-identical to
 * the previous IR-indexed implementation, since `chunk.positions` carries the same endpoints.
 */
export function buildTubeChunk(chunk: GeometryChunk, opts: TubeOptions = {}): TubeChunkGeometry {
  checkTubeOptions(opts);
  const lineWidth = opts.lineWidth ?? 0.6;
  const lineHeight = opts.lineHeight ?? 0.2;
  const radialSegments = opts.radialSegments ?? 8;
  const maxVertices = opts.maxVertices ?? DEFAULT_MAX_VERTICES;
  const ringSize = radialSegments + 1; // inherited seam-duplicate ring layout
  const indicesPerSegment = radialSegments * 6;

  const starts = findPolylines(chunk);
  // Each polyline of n segments has n+1 rings.
  const ringCount = chunk.count + starts.length;
  const vertexCount = ringCount * ringSize;
  if (vertexCount > maxVertices) {
    throw new RangeError(
      `tube geometry needs ${vertexCount} vertices (> budget ${maxVertices}); use lines mode for this chunk`
    );
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(chunk.count * indicesPerSegment);
  const vertexSegment = new Uint32Array(vertexCount);

  const pos = chunk.positions; // 6 floats per included segment: x0,y0,z0,x1,y1,z1
  // Per-ring point of the active polyline (px/py/pz), with its neighbors for the
  // inherited corner-averaged tangent.
  let ringBase = 0; // vertex index of the ring being written
  let indexWrite = 0;

  const writeRing = (
    px: number,
    py: number,
    pz: number,
    prevX: number,
    prevY: number,
    prevZ: number,
    nextX: number,
    nextY: number,
    nextZ: number,
    segOrdinal: number
  ): void => {
    // Inherited computeCornerAngles: tangent = normalize(normalize(P-prev) + normalize(next-P)).
    let t1x = px - prevX;
    let t1y = py - prevY;
    let t1z = pz - prevZ;
    let len = Math.hypot(t1x, t1y, t1z);
    if (len > 0) {
      t1x /= len;
      t1y /= len;
      t1z /= len;
    }
    let t2x = nextX - px;
    let t2y = nextY - py;
    let t2z = nextZ - pz;
    len = Math.hypot(t2x, t2y, t2z);
    if (len > 0) {
      t2x /= len;
      t2y /= len;
      t2z /= len;
    }
    let tx = t1x + t2x;
    let ty = t1y + t2y;
    let tz = t1z + t2z;
    len = Math.hypot(tx, ty, tz);
    if (len > 0) {
      tx /= len;
      ty /= len;
      tz /= len;
    } else {
      tx = 1; // degenerate (zero-length neighborhood): arbitrary stable tangent
    }

    // Inherited smallest-axis normal pick.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const ax = Math.abs(tx);
    const ay = Math.abs(ty);
    const az = Math.abs(tz);
    let min = Number.MAX_VALUE;
    if (ax <= min) {
      min = ax;
      nx = 1;
      ny = 0;
      nz = 0;
    }
    if (ay <= min) {
      min = ay;
      nx = 0;
      ny = 1;
      nz = 0;
    }
    if (az <= min) {
      nx = 0;
      ny = 0;
      nz = 1;
    }
    // vec = normalize(cross(tangent, N)); N = cross(tangent, vec); B = cross(tangent, N).
    let vx = ty * nz - tz * ny;
    let vy = tz * nx - tx * nz;
    let vz = tx * ny - ty * nx;
    len = Math.hypot(vx, vy, vz);
    if (len > 0) {
      vx /= len;
      vy /= len;
      vz /= len;
    }
    const Nx = ty * vz - tz * vy;
    const Ny = tz * vx - tx * vz;
    const Nz = tx * vy - ty * vx;
    const Bx = ty * Nz - tz * Ny;
    const By = tz * Nx - tx * Nz;
    const Bz = tx * Ny - ty * Nx;

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      let ox = cos * Nx + sin * Bx;
      let oy = cos * Ny + sin * By;
      let oz = cos * Nz + sin * Bz;
      len = Math.hypot(ox, oy, oz);
      if (len > 0) {
        ox /= len;
        oy /= len;
        oz /= len;
      }
      const vi = ringBase + j;
      normals[vi * 3] = ox;
      normals[vi * 3 + 1] = oy;
      normals[vi * 3 + 2] = oz;
      // Inherited ring formula: elliptical W×H cross-section, dropped by H/2 so
      // the tube's top face sits at the nozzle path height.
      positions[vi * 3] = px + lineWidth * ox * 0.5;
      positions[vi * 3 + 1] = py + lineWidth * oy * 0.5;
      positions[vi * 3 + 2] = pz + lineHeight * oz * 0.5 - lineHeight * 0.5;
      vertexSegment[vi] = segOrdinal;
    }
    ringBase += ringSize;
  };

  for (let p = 0; p < starts.length; p++) {
    const runStart = starts[p];
    const runEnd = p + 1 < starts.length ? starts[p + 1] : chunk.count; // exclusive
    const runLen = runEnd - runStart;
    const firstRingVertex = ringBase;

    for (let k = runStart; k < runEnd; k++) {
      const b = k * 6; // this segment: start (b..b+2), end (b+3..b+5)
      const pb = k > runStart ? (k - 1) * 6 : -1; // previous segment's start, or -1 at the run head
      // Ring at this segment's start point; neighbors: previous segment's start
      // (or the point itself at the run head) and this segment's end.
      writeRing(
        pos[b],
        pos[b + 1],
        pos[b + 2],
        pb >= 0 ? pos[pb] : pos[b],
        pb >= 0 ? pos[pb + 1] : pos[b + 1],
        pb >= 0 ? pos[pb + 2] : pos[b + 2],
        pos[b + 3],
        pos[b + 4],
        pos[b + 5],
        k
      );
    }
    // Closing ring at the run's final endpoint.
    const lb = (runEnd - 1) * 6; // final segment: start (lb..lb+2), end (lb+3..lb+5)
    writeRing(
      pos[lb + 3],
      pos[lb + 4],
      pos[lb + 5],
      pos[lb],
      pos[lb + 1],
      pos[lb + 2],
      pos[lb + 3],
      pos[lb + 4],
      pos[lb + 5],
      runEnd - 1
    );

    // Indices in chunk-local segment order: ring pair (k, k+1) per segment,
    // inherited quad topology (a,b,d / b,c,d).
    for (let k = 0; k < runLen; k++) {
      const r0 = firstRingVertex + k * ringSize;
      const r1 = r0 + ringSize;
      for (let i = 1; i <= radialSegments; i++) {
        const a = r0 + (i - 1);
        const b = r1 + (i - 1);
        const c = r1 + i;
        const d = r0 + i;
        indices[indexWrite++] = a;
        indices[indexWrite++] = b;
        indices[indexWrite++] = d;
        indices[indexWrite++] = b;
        indices[indexWrite++] = c;
        indices[indexWrite++] = d;
      }
    }
  }

  return { positions, normals, indices, vertexSegment, indicesPerSegment, vertexCount };
}
