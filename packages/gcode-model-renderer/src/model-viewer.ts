/**
 * `createModelViewer` (DD-021 Phase 1) — the **interactive** analogue of `renderModelStill`: orbit /
 * zoom / pan a source model (STL / 3MF, incl. production `paint_color` multicolor) in the browser.
 *
 * It composes the pieces that already exist rather than building a parallel renderer:
 *  - the shared {@link InteractiveStage} (GL + dual camera + orbit/zoom/pan + context-loss recovery +
 *    DD-020 interaction quality) from `@chestnutlabs/gcode-renderer-three`,
 *  - the shared {@link ModelContent} scene core (root + studio lights + capability-honest meshes),
 *  - the open-`kind` {@link resolveModelScene} loader registry.
 *
 * It is a **distinct surface** from `ToolpathRenderer` / `<GcodePreview>` (no layers/travel/scrub/IR);
 * capability tiers are passed through from the parsed `ModelScene`, never recomputed (DD-001 honesty).
 * Interactive is a browser concern — headless/offscreen stills stay `renderModelStill` (DD-018 §4.3).
 */
import { Color, Scene } from 'three';
import {
  InteractiveStage,
  createDefaultGLRenderer,
  type CameraMode,
  type CameraState,
  type CameraView,
  type GLRendererLike,
  type InteractiveStageOptions,
  type RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import type { Confidence } from '@chestnutlabs/toolpath-core';
import { ModelContent } from './model-content.js';
import { DEFAULT_MODEL_LOADERS, resolveModelScene, type ModelLoader, type ModelSourceInput } from './loaders.js';
import { ModelParseError, type ModelLimits } from './limits.js';
import type { ModelBackground, PresentationView } from './model-renderer.js';
import { sceneInstanceCount, type ModelBounds, type ModelPlateSummary, type ModelScene } from './scene-model.js';

export interface ModelViewerOptions {
  /** Loader registry (open `kind`). Default: `[stlLoader, threeMfLoader]`. */
  loaders?: readonly ModelLoader[];
  /** `'transparent'` (default) | CSS colour | `0xRRGGBB` (DD-018). */
  background?: ModelBackground;
  /** DD-020 interaction-aware quality; default `'auto'` (the interactive default). */
  interactionQuality?: 'off' | 'auto';
  /** Initial camera projection; default `'perspective'`. */
  cameraMode?: CameraMode;
  /** Source-model triangle / byte caps (DD-018 `ModelLimits`). */
  limits?: ModelLimits;
  /** 3MF `paint_color` palette override (hex `#RRGGBB` per 0-based slot); parity with `renderModelStill`. */
  filamentPalette?: readonly (string | undefined)[];
  /** Injected GL (tests / exotic hosts). Default: the shared stage builder with alpha on. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  /** Injected orbit controls (tests). Default: three `OrbitControls` via the stage. */
  createControls?: NonNullable<InteractiveStageOptions['createControls']>;
}

/** What the source actually carried, surfaced on `ready` (never fabricated — DD-001). */
export interface ModelReadyInfo {
  objectCount: number;
  materials: Confidence;
  bounds: ModelBounds;
  /**
   * Total instance placements drawn (DD-022): > `objectCount` when the source reused geometry, for an "N
   * copies" badge. 1 per object when nothing is reused.
   */
  instancedCount: number;
  /**
   * Every-Nth-triangle decimation applied to fit the LOD budget (1 = none). Field-parallel to the toolpath
   * `decimationApplied` so a card badges "simplified for size" the same way. Always 1 until model LOD lands
   * (DD-022 Phase 2); reserved so the field is stable.
   */
  decimationApplied: number;
  /**
   * Declared plate structure (DD-025), present only when the source explicitly declares plates
   * (`capabilities.plates === 'known'`). A consumer builds a plate selector from `plates.list`; absent for a
   * single/plate-less source. `active` is the source's declared active plate id when present.
   */
  plates?: { list: ModelPlateSummary[]; active?: number };
  // Reserved additive extension (not v1): `objects?: { name?: string; materials?: Confidence }[]`.
}

export type ModelViewerEvent =
  | { type: 'ready'; info: ModelReadyInfo }
  | { type: 'camera-changed'; state: CameraState }
  | { type: 'error'; code: string; message: string }
  | { type: 'renderer-unsupported'; feature: string; message: string }
  | { type: 'context-lost' }
  | { type: 'context-restored' };

export interface ModelViewer {
  /** Parse → build → frame → `ready`. Async (3MF unzips). Overlapping calls are last-wins. */
  setSource(input: ModelSourceInput): Promise<ModelReadyInfo>;
  /** Snap to a preset orientation (shared with the toolpath camera). */
  setView(view: PresentationView | CameraView): void;
  /** Current camera pose, or `null` before a source is set / when the renderer is unsupported. */
  getCameraState(): CameraState | null;
  setCameraState(state: CameraState): void;
  setBackground(bg: ModelBackground): void;
  setInteractionQuality(mode: 'off' | 'auto'): void;
  resize(width: number, height: number): void;
  /** Re-fit the camera to the current model bounds. */
  frame(): void;
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  dispose(): void;
}

function backgroundColor(bg: ModelBackground): Color | null {
  return bg === 'transparent' ? null : new Color(bg as string | number);
}

/**
 * Create an interactive model viewer bound to a live `<canvas>`. If WebGL is unavailable the handle is
 * still returned but inert; it emits a `renderer-unsupported` event (flushed to the first `onEvent`
 * subscriber) so the consumer can fall back to a `renderModelStill` image (DD-021 §6).
 */
export function createModelViewer(canvas: RenderTargetCanvas, options: ModelViewerOptions = {}): ModelViewer {
  const loaders = options.loaders ?? DEFAULT_MODEL_LOADERS;
  const limits = options.limits;
  const filamentPalette = options.filamentPalette;
  const background: ModelBackground = options.background ?? 'transparent';

  const listeners = new Set<(e: ModelViewerEvent) => void>();
  // Events emitted before any subscriber attaches (e.g. renderer-unsupported at construction) are held
  // and flushed to the first subscriber, so the create-then-onEvent consumer flow never drops them.
  const pending: ModelViewerEvent[] = [];
  const emit = (e: ModelViewerEvent): void => {
    if (listeners.size === 0) {
      pending.push(e);
      return;
    }
    for (const l of listeners) l(e);
  };

  const scene = new Scene();
  scene.background = backgroundColor(background);
  const content = new ModelContent(scene);

  // Retained so context-loss recovery can rebuild meshes from the last-set scene.
  let currentScene: ModelScene | null = null;
  let disposed = false;
  // Monotonic token for last-wins overlapping setSource (stale async results are discarded).
  let sourceToken = 0;

  let stage: InteractiveStage | null = null;
  try {
    stage = new InteractiveStage({
      canvas,
      scene,
      cameraMode: options.cameraMode ?? 'perspective',
      interactionQuality: options.interactionQuality ?? 'auto',
      createRenderer: options.createRenderer ?? ((c) => createDefaultGLRenderer(c, { alpha: true })),
      ...(options.createControls ? { createControls: options.createControls } : {}),
      onCameraChanged: (state) => emit({ type: 'camera-changed', state }),
      onContextLost: () => emit({ type: 'context-lost' }),
      onContextRestored: () => {
        // GPU resources are gone; rebuild meshes from the retained scene and reframe, mirroring the
        // toolpath renderer's recovery.
        if (currentScene !== null && stage !== null) {
          content.setScene(currentScene);
          const f = content.framing;
          if (f !== null) stage.frameTo(f.center, f.radius);
        }
        emit({ type: 'context-restored' });
      }
    });
  } catch (err) {
    emit({
      type: 'renderer-unsupported',
      feature: 'webgl2',
      message: err instanceof Error ? err.message : String(err)
    });
  }

  async function setSource(input: ModelSourceInput): Promise<ModelReadyInfo> {
    const my = ++sourceToken;
    if (stage === null || disposed) {
      const message = disposed ? 'model viewer is disposed' : 'WebGL renderer unavailable';
      emit({ type: 'error', code: 'E_MODEL_RENDERER_UNAVAILABLE', message });
      throw new ModelParseError('E_MODEL_RENDERER_UNAVAILABLE', message);
    }
    try {
      const parsed = await resolveModelScene(input, loaders, limits, filamentPalette ? { filamentPalette } : undefined);
      const info: ModelReadyInfo = {
        objectCount: parsed.objects.length,
        materials: parsed.capabilities.materials,
        bounds: parsed.bounds,
        instancedCount: sceneInstanceCount(parsed),
        decimationApplied: 1
      };
      if (parsed.plates !== undefined) info.plates = parsed.plates;
      // Last-wins: a newer setSource (or a dispose) superseded this one — discard without mutating.
      if (my !== sourceToken || disposed || stage === null) return info;

      content.setScene(parsed);
      currentScene = parsed;
      const f = content.framing;
      if (f !== null) stage.frameTo(f.center, f.radius);
      emit({ type: 'ready', info });
      return info;
    } catch (err) {
      const code = err instanceof ModelParseError ? err.code : 'E_MODEL_PARSE';
      const message = err instanceof Error ? err.message : String(err);
      // Loader/limit failures surface as an event, never thrown out of the render loop (DD §6) — but the
      // returned promise still rejects so an awaiting caller sees the failure.
      emit({ type: 'error', code, message });
      throw err;
    }
  }

  return {
    setSource,
    setView(view) {
      stage?.setView(view as CameraView);
    },
    getCameraState() {
      return stage ? stage.getCameraState() : null;
    },
    setCameraState(state) {
      stage?.setCameraState(state);
    },
    setBackground(bg) {
      scene.background = backgroundColor(bg);
      stage?.render();
    },
    setInteractionQuality(mode) {
      stage?.setInteractionQuality(mode);
    },
    resize(width, height) {
      stage?.resize(width, height);
    },
    frame() {
      const f = content.framing;
      if (f !== null) stage?.frameTo(f.center, f.radius);
    },
    onEvent(cb) {
      listeners.add(cb);
      if (pending.length > 0) {
        const flushed = pending.splice(0, pending.length);
        for (const e of flushed) cb(e);
      }
      return () => listeners.delete(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stage?.dispose();
      content.dispose();
      listeners.clear();
    }
  };
}
