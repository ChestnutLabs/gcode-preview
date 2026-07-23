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

/** Per-chunk split for the live-progress overlay (DD-006 §4.5). */
export interface OverlayDrawStates {
  /** Segments completed by the printer (IR index <= loSeg), within the layer range. */
  completed: ChunkDrawState;
  /** Uncertainty band (loSeg < index <= hiSeg) — empty when loSeg === hiSeg. */
  band: ChunkDrawState;
  /** Remaining path (index > hiSeg) — the translucent ghost pass. */
  ghost: ChunkDrawState;
}

/**
 * Split a chunk into completed / band / ghost draw ranges around a progress position
 * (DD-006 §4.5): the completed cut sits at `loSeg`, the ghost starts after `hiSeg`,
 * and the emphasis band covers the uncertainty between them. Same O(log n) bounds as
 * `computeDrawState`; composes with the layer range by intersection. Pass `loSeg = -1`
 * for "nothing completed yet" (everything after the band is ghost).
 */
export function computeOverlayDrawStates(
  ir: ToolpathIR,
  chunk: GeometryChunk,
  startLayer: number,
  endLayer: number,
  loSeg: number,
  hiSeg: number
): OverlayDrawStates {
  const all = computeDrawState(ir, chunk, startLayer, endLayer);
  if (!all.visible) {
    const empty: ChunkDrawState = { visible: false, drawStart: 0, drawCount: 0 };
    return { completed: empty, band: empty, ghost: empty };
  }
  const toLo = computeDrawState(ir, chunk, startLayer, endLayer, loSeg);
  const toHi = hiSeg === loSeg ? toLo : computeDrawState(ir, chunk, startLayer, endLayer, hiSeg);
  const loEnd = toLo.drawStart + toLo.drawCount;
  const hiEnd = toHi.drawStart + toHi.drawCount;
  const allEnd = all.drawStart + all.drawCount;
  const bandCount = Math.max(0, hiEnd - loEnd);
  const ghostCount = Math.max(0, allEnd - hiEnd);
  return {
    completed: { ...toLo, visible: toLo.visible && toLo.drawCount > 0 },
    band: { visible: bandCount > 0, drawStart: loEnd, drawCount: bandCount },
    ghost: { visible: ghostCount > 0, drawStart: hiEnd, drawCount: ghostCount }
  };
}
