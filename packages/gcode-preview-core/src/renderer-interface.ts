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
  CameraState,
  CameraView,
  ColorMode,
  QualityMode,
  QualityPolicy,
  RendererEvent,
  Theme
} from '@chestnutlabs/gcode-renderer-three';

export type { CameraState, CameraView } from '@chestnutlabs/gcode-renderer-three';
import type { MachineGeometry, MappedProgress, ToolpathIR } from '@chestnutlabs/toolpath-core';

/** Which renderer implementation backs the preview. `'3d'` is the default (Three.js). */
export type RendererMode = '2d' | '3d';

/**
 * Move classes whose visibility can be toggled independently (DD-009 travel toggle + DD-016 wipe).
 * `'wipe'` is honored by the 3D renderer as its own chunk; the flat 2D view treats it as a no-op.
 */
export type MoveKindToggle = 'extrude' | 'travel' | 'wipe';

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
  /** Show/hide the build-volume wireframe cage independently of the bed/plate (#306/#6). */
  setBuildVolumeCage(visible: boolean): void;
  /** Frame the printed 'object' (excl. skirt/prime) vs 'all' extrusion (#306/#6). */
  setFrameContent(mode: 'object' | 'all'): void;
  /** Interaction-aware quality: 'auto' reduces detail while the camera moves (#306/2, DD-020). */
  setInteractionQuality(mode: 'off' | 'auto'): void;
  setLayerRange(startLayer: number, endLayer: number): void;
  setScrubPosition(segIndex: number | null): void;
  setKindVisible(kind: MoveKindToggle, visible: boolean): void;
  setShowRetractions(visible: boolean): void;
  setColorMode(mode: ColorMode): boolean;
  setQuality(quality: QualityMode | 'auto'): void;
  /** Fidelity policy (DD-023 §4 D6): 'full' | 'adaptive' | 'fast'. 3D only; 2D is a no-op. */
  setQualityMode(mode: QualityPolicy): void;
  setCameraMode(mode: CameraMode): void;
  /** Snap to a preset orientation (#268). 2D renderers disclose via `renderer-unsupported`. */
  setView(view: CameraView): void;
  /** Read the current camera as a serializable snapshot (#268). Null when the renderer has no 3D pose (2D). */
  getCameraState(): CameraState | null;
  /** Restore a camera snapshot verbatim (#268). 2D renderers disclose via `renderer-unsupported`. */
  setCameraState(state: CameraState): void;
  setTheme(theme: Theme): void;
  setProgress(p: MappedProgress | null): void;
  /**
   * Pick the IR segment under a pointer (normalized device coords in [-1, 1]), or null (#184). The 3D
   * renderer raycasts the toolpath; the 2D renderer returns null (no picking yet).
   */
  pickSegment(ndcX: number, ndcY: number, threshold?: number): number | null;
  frame(): void;
  dispose(): void;
}
