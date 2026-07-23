/**
 * Per-vertex color building (DD-004 §4.6, phase 1).
 *
 * Colors are computed renderer-side from the IR's `tool`/`feature` channels and a
 * consumer palette; recoloring rewrites this attribute without touching geometry.
 * Feature mode must be capability-gated by the caller (`featureRoles` may be
 * `unavailable` — the UI is told, not silently shown nonsense).
 */
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { GeometryChunk } from './chunks.js';

export type RGB = [number, number, number];

export type ColorMode =
  | { mode: 'single'; color: RGB }
  | { mode: 'tool'; palette: RGB[]; fallback?: RGB }
  | { mode: 'feature'; palette: RGB[]; fallback: RGB };

const DEFAULT_FALLBACK: RGB = [0.7, 0.7, 0.7];

/** Build the interleaved color attribute for a chunk: 6 floats per segment (both vertices). */
export function buildChunkColors(ir: ToolpathIR, chunk: GeometryChunk, mode: ColorMode): Float32Array {
  const colors = new Float32Array(chunk.count * 6);
  const seg = ir.segments;
  for (let k = 0; k < chunk.count; k++) {
    const i = chunk.segIndices[k];
    let rgb: RGB;
    if (mode.mode === 'single') {
      rgb = mode.color;
    } else if (mode.mode === 'tool') {
      const tool = seg.tool[i];
      rgb = mode.palette.length > 0 ? mode.palette[tool % mode.palette.length] : (mode.fallback ?? DEFAULT_FALLBACK);
    } else {
      const feature = seg.feature[i];
      // Feature 0 = unknown (DD-001): fallback color, never a fabricated role color.
      rgb = feature === 0 ? mode.fallback : mode.palette[(feature - 1) % mode.palette.length];
    }
    const o = k * 6;
    colors[o] = rgb[0];
    colors[o + 1] = rgb[1];
    colors[o + 2] = rgb[2];
    colors[o + 3] = rgb[0];
    colors[o + 4] = rgb[1];
    colors[o + 5] = rgb[2];
  }
  return colors;
}
