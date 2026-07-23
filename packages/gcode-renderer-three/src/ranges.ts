/**
 * Draw-range math for layer clipping and intra-layer scrub (DD-004 §4.5, phase 1).
 *
 * Because IR segments are layer-contiguous and chunks preserve IR order, a layer
 * range maps to whole-chunk visibility plus drawRange trims on boundary chunks,
 * and a scrub position is an upper-bound cut on the chunk's segIndices — all
 * O(log n) per chunk, no shader dependency, identical in lines and tubes modes.
 */
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { GeometryChunk } from './chunks.js';

export interface ChunkDrawState {
  visible: boolean;
  /** First included segment (chunk-local index). */
  drawStart: number;
  /** Number of included segments from drawStart. */
  drawCount: number;
}

/** First chunk-local index whose IR layer >= startLayer (segments are layer-ordered). */
function lowerBoundByLayer(ir: ToolpathIR, chunk: GeometryChunk, startLayer: number): number {
  const layerOf = ir.segments.layer;
  let lo = 0;
  let hi = chunk.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layerOf[chunk.segIndices[mid]] < startLayer) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** One past the last chunk-local index whose IR layer <= endLayer. */
function upperBoundByLayer(ir: ToolpathIR, chunk: GeometryChunk, endLayer: number): number {
  const layerOf = ir.segments.layer;
  let lo = 0;
  let hi = chunk.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layerOf[chunk.segIndices[mid]] <= endLayer) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** One past the last chunk-local index whose IR segment index <= scrubSegIndex. */
function upperBoundBySegment(chunk: GeometryChunk, scrubSegIndex: number): number {
  let lo = 0;
  let hi = chunk.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (chunk.segIndices[mid] <= scrubSegIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Compute a chunk's visibility and draw range for an inclusive layer range and an
 * optional scrub cutoff (render segments with IR index <= scrubSegIndex only).
 */
export function computeDrawState(
  ir: ToolpathIR,
  chunk: GeometryChunk,
  startLayer: number,
  endLayer: number,
  scrubSegIndex?: number
): ChunkDrawState {
  if (chunk.layerEnd < startLayer || chunk.layerStart > endLayer || chunk.count === 0) {
    return { visible: false, drawStart: 0, drawCount: 0 };
  }
  const start = chunk.layerStart >= startLayer ? 0 : lowerBoundByLayer(ir, chunk, startLayer);
  let end = chunk.layerEnd <= endLayer ? chunk.count : upperBoundByLayer(ir, chunk, endLayer);
  if (scrubSegIndex !== undefined) {
    const cut = upperBoundBySegment(chunk, scrubSegIndex);
    if (cut < end) end = cut;
  }
  const drawCount = Math.max(0, end - start);
  return { visible: drawCount > 0, drawStart: start, drawCount };
}
