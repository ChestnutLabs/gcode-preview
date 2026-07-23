/**
 * Pure geometry builders (DD-004 §4.3/§4.4, phase 1, issue #56).
 *
 * Turns a DD-001 `ToolpathIR` into layer-aligned geometry chunks ready for
 * GL_LINES upload: interleaved position buffers copied straight from the IR's
 * origin-relative Float32 SoA (zero conversion, zero precision loss), split by
 * kind (extrude/travel) so visibility toggling is whole-chunk work.
 *
 * Decimation (§4.4, Sindarius behavior spec): every-Nth extrusion-segment
 * reduction stepped by total count, ALWAYS keeping layer-boundary segments so
 * silhouettes and layer counts stay honest; travel hides first (no travel
 * chunks when decimating). The reduction factor is returned so consumers can
 * disclose it — degrading honestly is part of the contract.
 *
 * No three.js import in this module: everything is pure typed-array work,
 * fully testable in Node (three enters in phase 2's scene layer).
 */
import { MoveKind, type ToolpathIR } from '@chestnutlabs/toolpath-core';

export interface ChunkBuildOptions {
  /** Target segments per chunk before closing at the next layer boundary (default 250_000). */
  targetSegmentsPerChunk?: number;
  /** Decimation factor N (keep every Nth extrusion segment) or 'auto' (§4.4 thresholds). */
  decimation?: number | 'auto';
}

export interface GeometryChunk {
  kind: 'extrude' | 'travel';
  /** Inclusive layer range covered by this chunk. */
  layerStart: number;
  layerEnd: number;
  /** Segments included (after decimation), in IR order. */
  count: number;
  /** Interleaved GL_LINES positions: 6 floats (x0,y0,z0,x1,y1,z1) per segment. */
  positions: Float32Array;
  /** Original IR segment index per included segment (for scrub/draw-range mapping). */
  segIndices: Uint32Array;
}

export interface ChunkBuildResult {
  chunks: GeometryChunk[];
  /** 1 = no reduction. Consumers MUST disclose values > 1 (§4.4). */
  decimationApplied: number;
  /** True when travel geometry was omitted because decimation is active. */
  travelHidden: boolean;
  totalSegmentsIncluded: number;
}

/** §4.4 provisional thresholds (ratified by the E3 benchmark phase). */
export function autoDecimation(extrudeSegmentCount: number): number {
  if (extrudeSegmentCount > 10_000_000) return 5;
  if (extrudeSegmentCount > 5_000_000) return 3;
  if (extrudeSegmentCount > 2_000_000) return 2;
  return 1;
}

const DEFAULT_TARGET = 250_000;

export function buildChunks(ir: ToolpathIR, opts: ChunkBuildOptions = {}): ChunkBuildResult {
  const seg = ir.segments;
  const target = opts.targetSegmentsPerChunk ?? DEFAULT_TARGET;

  let extrudeCount = 0;
  for (let i = 0; i < seg.count; i++) {
    if ((seg.kind[i] & MoveKind.Extrude) !== 0) extrudeCount++;
  }
  const decimation =
    opts.decimation === 'auto' || opts.decimation === undefined ? autoDecimation(extrudeCount) : opts.decimation;
  const travelHidden = decimation > 1;

  // Layer-boundary segments are always kept (§4.4). A layer's segStart/segEnd may
  // land on travel moves (hidden under decimation), so the honest boundary is the
  // first and last EXTRUSION segment within each layer's range.
  const boundary = new Set<number>();
  for (const layer of ir.layers) {
    let first = -1;
    let last = -1;
    for (let i = layer.segStart; i <= layer.segEnd && i < seg.count; i++) {
      if ((seg.kind[i] & MoveKind.Extrude) !== 0) {
        if (first === -1) first = i;
        last = i;
      }
    }
    if (first !== -1) {
      boundary.add(first);
      boundary.add(last);
    }
  }

  const chunks: GeometryChunk[] = [];
  let totalIncluded = 0;

  // Walk layers in order, accumulating segment indices per kind; close chunks at
  // layer boundaries once the target is exceeded (layer-aligned chunking, §4.3).
  let pendingExtrude: number[] = [];
  let pendingTravel: number[] = [];
  let chunkLayerStart = 0;
  let kept = 0;

  const flush = (layerEnd: number): void => {
    for (const [kind, list] of [
      ['extrude', pendingExtrude],
      ['travel', pendingTravel]
    ] as const) {
      if (list.length === 0) continue;
      const positions = new Float32Array(list.length * 6);
      const segIndices = new Uint32Array(list.length);
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const o = k * 6;
        positions[o] = seg.x0[i];
        positions[o + 1] = seg.y0[i];
        positions[o + 2] = seg.z0[i];
        positions[o + 3] = seg.x1[i];
        positions[o + 4] = seg.y1[i];
        positions[o + 5] = seg.z1[i];
        segIndices[k] = i;
      }
      chunks.push({ kind, layerStart: chunkLayerStart, layerEnd, count: list.length, positions, segIndices });
      totalIncluded += list.length;
    }
    pendingExtrude = [];
    pendingTravel = [];
    kept = 0;
  };

  const layerCount = ir.layers.length;
  if (layerCount === 0) {
    // No layer table (empty IR): nothing to build.
    return { chunks, decimationApplied: decimation, travelHidden, totalSegmentsIncluded: 0 };
  }

  for (let li = 0; li < layerCount; li++) {
    const layer = ir.layers[li];
    for (let i = layer.segStart; i <= layer.segEnd && i < seg.count; i++) {
      const isExtrude = (seg.kind[i] & MoveKind.Extrude) !== 0;
      if (isExtrude) {
        if (decimation === 1 || boundary.has(i) || i % decimation === 0) {
          pendingExtrude.push(i);
          kept++;
        }
      } else if (!travelHidden) {
        pendingTravel.push(i);
        kept++;
      }
    }
    if (kept >= target || li === layerCount - 1) {
      flush(li);
      chunkLayerStart = li + 1;
    }
  }

  return { chunks, decimationApplied: decimation, travelHidden, totalSegmentsIncluded: totalIncluded };
}
