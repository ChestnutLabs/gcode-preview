/**
 * Per-vertex color building (DD-004 §4.6, phase 1) — the Three.js side of the color subsystem.
 *
 * The color *semantics* (the `ColorMode` union and the per-segment RGB) live in the
 * renderer-agnostic `@chestnutlabs/gcode-colors` package (DD-014 D3), single-sourced so the 3D
 * and 2D renderers never drift. This module only maps that per-segment RGB onto Three.js's
 * interleaved vertex-color attribute; recoloring rewrites this buffer without touching geometry.
 * Feature/object/feedrate modes must be capability-gated by the caller.
 */
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { createSegmentColorer } from '@chestnutlabs/gcode-colors';
import type { ColorMode, RGB } from '@chestnutlabs/gcode-colors';
import type { GeometryChunk } from './chunks.js';

export type { ColorMode, RGB } from '@chestnutlabs/gcode-colors';
export { feedrateRange } from '@chestnutlabs/gcode-colors';

/** Build the interleaved color attribute for a chunk: 6 floats per segment (both vertices). */
export function buildChunkColors(ir: ToolpathIR, chunk: GeometryChunk, mode: ColorMode): Float32Array {
  const colors = new Float32Array(chunk.count * 6);
  const colorOf = createSegmentColorer(ir, mode);
  for (let k = 0; k < chunk.count; k++) {
    const rgb: RGB = colorOf(chunk.segIndices[k]);
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
