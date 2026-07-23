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
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
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

/**
 * Split a chunk's included segments into connected polylines: a new run starts
 * whenever the previous segment's end is not this segment's start (Float32
 * values copied verbatim from the IR, so exact comparison is sound).
 */
function findPolylines(ir: ToolpathIR, chunk: GeometryChunk): number[] {
  const seg = ir.segments;
  const starts: number[] = [];
  for (let k = 0; k < chunk.count; k++) {
    if (k === 0) {
      starts.push(0);
      continue;
    }
    const prev = chunk.segIndices[k - 1];
    const cur = chunk.segIndices[k];
    if (seg.x1[prev] !== seg.x0[cur] || seg.y1[prev] !== seg.y0[cur] || seg.z1[prev] !== seg.z0[cur]) {
      starts.push(k);
    }
  }
  return starts;
}

export function buildTubeChunk(ir: ToolpathIR, chunk: GeometryChunk, opts: TubeOptions = {}): TubeChunkGeometry {
  const lineWidth = opts.lineWidth ?? 0.6;
  const lineHeight = opts.lineHeight ?? 0.2;
  const radialSegments = opts.radialSegments ?? 8;
  const maxVertices = opts.maxVertices ?? DEFAULT_MAX_VERTICES;
  const ringSize = radialSegments + 1; // inherited seam-duplicate ring layout
  const indicesPerSegment = radialSegments * 6;

  const starts = findPolylines(ir, chunk);
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

  const seg = ir.segments;
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
      const i = chunk.segIndices[k];
      const prevI = k > runStart ? chunk.segIndices[k - 1] : -1;
      // Ring at this segment's start point; neighbors: previous segment's start
      // (or the point itself at the run head) and this segment's end.
      writeRing(
        seg.x0[i],
        seg.y0[i],
        seg.z0[i],
        prevI >= 0 ? seg.x0[prevI] : seg.x0[i],
        prevI >= 0 ? seg.y0[prevI] : seg.y0[i],
        prevI >= 0 ? seg.z0[prevI] : seg.z0[i],
        seg.x1[i],
        seg.y1[i],
        seg.z1[i],
        k
      );
    }
    // Closing ring at the run's final endpoint.
    const last = chunk.segIndices[runEnd - 1];
    writeRing(
      seg.x1[last],
      seg.y1[last],
      seg.z1[last],
      seg.x0[last],
      seg.y0[last],
      seg.z0[last],
      seg.x1[last],
      seg.y1[last],
      seg.z1[last],
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
