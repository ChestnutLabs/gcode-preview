/**
 * The renderer-agnostic seam the controller talks to (DD-014 D5). Both the Three.js
 * renderer (`@chestnutlabs/gcode-renderer-three`, loaded on demand) and the low-resource
 * 2D renderer (`@chestnutlabs/gcode-renderer-2d`) satisfy {@link PreviewRenderer}, so the
 * controller picks one behind this interface from a single `renderer.mode` option.
 *
 * The `gcode-renderer-three` imports here are **type-only** (erased at build): they must not
 * pull Three.js into a 2D-only bundle. The 3D renderer's *values* are reached only through a
 * dynamic `import()` in the controller, so a bundler drops Three.js when `mode` is `'2d'`.
 */
import type {
  BuildVolumeDef,
  CameraMode,
  ColorMode,
  QualityMode,
  RendererEvent,
  Theme
} from '@chestnutlabs/gcode-renderer-three';
import type { MachineGeometry, MappedProgress, ToolpathIR } from '@chestnutlabs/toolpath-core';

/** Which renderer implementation backs the preview. `'3d'` is the default (Three.js). */
export type RendererMode = '2d' | '3d';

/**
 * Renderer events seen by the controller. The 3D renderer emits {@link RendererEvent}; either
 * renderer may emit `renderer-unsupported` to disclose a requested option it cannot honor (e.g.
 * a camera mode on the flat 2D view) — an honest capability signal, never a hard error.
 */
export type PreviewRendererEvent = RendererEvent | { type: 'renderer-unsupported'; feature: string; message: string };

/**
 * The minimal renderer contract the controller drives. 3D-only members are honored by the 2D
 * renderer as documented no-ops or `renderer-unsupported` disclosures — never fabricated output.
 */
export interface PreviewRenderer {
  onEvent(cb: (e: PreviewRendererEvent) => void): () => void;
  resize(width: number, height: number): void;
  setIR(ir: ToolpathIR): void;
  /** Progressive partial IR (3D only; the 2D renderer draws on the final IR). */
  appendPartial(slice: ToolpathIR): void;
  readonly layerCount: number;
  readonly segmentCount: number;
  setBuildVolume(def: BuildVolumeDef | MachineGeometry): void;
  setLayerRange(startLayer: number, endLayer: number): void;
  setScrubPosition(segIndex: number | null): void;
  setKindVisible(kind: 'extrude' | 'travel', visible: boolean): void;
  setShowRetractions(visible: boolean): void;
  setColorMode(mode: ColorMode): boolean;
  setQuality(quality: QualityMode | 'auto'): void;
  setCameraMode(mode: CameraMode): void;
  setTheme(theme: Theme): void;
  setProgress(p: MappedProgress | null): void;
  frame(): void;
  dispose(): void;
}
