/**
 * `createModelPreviewController` (DD-031) — the framework-neutral **controller** for interactive
 * source-model viewing, the Prepare-side analogue of `@chestnutlabs/gcode-preview-core`'s
 * `createPreviewController` (the Preview/toolpath side). The four framework adapters
 * (`@chestnutlabs/gcode-preview-{vue,react,svelte,element}/model`) are thin shells over THIS one
 * contract, exactly as they are over the toolpath controller — so model viewing gains real declarative
 * parity (lifecycle, options, events, capability exposure, cleanup, error handling) instead of every
 * consumer dropping to the imperative `createModelViewer` engine.
 *
 * It wraps the existing {@link createModelViewer} engine unchanged (no renderer redesign — DD-031
 * guardrail); the controller adds only what a framework binding needs and the engine doesn't provide:
 *  - **canvas-deferred construction** — the engine takes its canvas at construction, but a framework
 *    attaches the canvas via a ref *after* the component mounts, so the controller creates the engine
 *    lazily on `bindCanvas` and rebuilds it if the canvas is replaced (StrictMode remounts, etc.),
 *    replaying the last source so the model survives a remount;
 *  - a **reactive state snapshot** (`getState`/`onStateChange`) derived from the engine's events, which
 *    is what `useSyncExternalStore` (React), `shallowReactive` (Vue), and the store contract (Svelte)
 *    subscribe to; the engine itself only emits events + a couple of getters;
 *  - an **op queue** so control/`setSource` calls made before the canvas binds are replayed in order.
 *
 * Distinct surface from the toolpath controller (no layers/travel/scrub/IR) — capability tiers pass
 * through from the parsed model, never recomputed (DD-001 honesty).
 */
import type {
  CameraState,
  CameraView,
  CaptureOptions,
  GLRendererLike,
  InteractiveStageOptions,
  LoadProgress,
  RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import type { Confidence } from '@chestnutlabs/toolpath-core';
import { createModelViewer, type ModelViewer, type ModelViewerEvent, type ModelReadyInfo } from './model-viewer.js';
import type { ModelSourceInput, ModelLoader } from './loaders.js';
import type { ModelBackground, PresentationView } from './model-renderer.js';
import type { ModelBounds, ModelPlateSummary, RenderScope } from './scene-model.js';
import type { ModelLimits } from './limits.js';

/**
 * Controller options — the engine's {@link ModelViewerOptions} minus the canvas (bound later). The
 * `onProgress` callback is still delivered to the consumer AND folded into `state.progress`.
 */
export interface ModelPreviewControllerOptions {
  loaders?: readonly ModelLoader[];
  background?: ModelBackground;
  interactionQuality?: 'off' | 'auto';
  cameraMode?: InteractiveStageOptions['cameraMode'];
  limits?: ModelLimits;
  filamentPalette?: readonly (string | undefined)[];
  renderScope?: RenderScope;
  /** Staged loading-progress (DD-024); also mirrored into `state.progress`. */
  onProgress?: (progress: LoadProgress) => void;
  /** Injected GL (tests / exotic hosts). */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  /** Injected orbit controls (tests). */
  createControls?: NonNullable<InteractiveStageOptions['createControls']>;
}

/** Reactive snapshot of the model viewer, derived from engine events. Immutable — every change replaces it. */
export interface ModelPreviewState {
  /** A `setSource` is in flight (parse → build). */
  loading: boolean;
  /** A source has loaded successfully at least once and is currently shown. */
  ready: boolean;
  /** False when WebGL is unavailable — the handle is inert; fall back to a `renderModelStill` image. */
  rendererSupported: boolean;
  /** Objects in the current source (0 before ready). */
  objectCount: number;
  /** Material/colour capability tier of the source (honesty model). */
  materials: Confidence;
  /** Instance placements drawn — `> objectCount` when geometry was reused ("N copies"). */
  instancedCount: number;
  /** Every-Nth-triangle decimation applied to fit the LOD budget (1 = none). */
  decimationApplied: number;
  /** Model bounds, or null before ready. */
  bounds: ModelBounds | null;
  /** Declared plate structure when the source declares plates (`materials`-style capability); else null. */
  plates: { list: ModelPlateSummary[]; active?: number } | null;
  /** Capability-aware convenience: the source declares plates (build a plate selector). */
  hasPlates: boolean;
  /** Current camera pose, or null before a source / when unsupported. */
  cameraState: CameraState | null;
  /** Latest staged loading progress (DD-024), or null. */
  progress: LoadProgress | null;
  /** Last error (parse/loader/limit/renderer), or null. */
  error: { code: string; message: string } | null;
}

/** Imperative controls — a thin proxy over the engine, queued until the canvas binds. */
export interface ModelPreviewControls {
  /** Parse → build → frame → `ready`. Async (3MF unzips). Overlapping calls are last-wins. */
  setSource(input: ModelSourceInput): Promise<ModelReadyInfo>;
  setView(view: PresentationView | CameraView): void;
  getCameraState(): CameraState | null;
  setCameraState(state: CameraState): void;
  setBackground(bg: ModelBackground): void;
  setInteractionQuality(mode: 'off' | 'auto'): void;
  /** Render only a subset of the source (`{ plateId }` / `{ objectIds }` / `{ instanceFilter }`); null = whole source. */
  setRenderScope(scope: RenderScope | null): void;
  /** Re-fit the camera to the current model bounds. */
  frame(): void;
  resize(width: number, height: number): void;
  /** Capture the current view as an image `Blob`; rejects with `E_CAPTURE_UNSUPPORTED` when unavailable. */
  capture(opts?: CaptureOptions): Promise<Blob>;
}

export interface ModelPreviewController {
  /** Attach (or, with null, detach) the live canvas. Creating/replacing the canvas (re)builds the engine. */
  bindCanvas(canvas: RenderTargetCanvas | null): void;
  controls: ModelPreviewControls;
  getState(): ModelPreviewState;
  onStateChange(cb: (state: ModelPreviewState) => void): () => void;
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  /** Escape hatch — the underlying engine (or null before a canvas is bound). */
  raw: { viewer: () => ModelViewer | null };
  dispose(): void;
}

export const INITIAL_MODEL_STATE: ModelPreviewState = {
  loading: false,
  ready: false,
  rendererSupported: true,
  objectCount: 0,
  materials: 'unavailable',
  instancedCount: 0,
  decimationApplied: 1,
  bounds: null,
  plates: null,
  hasPlates: false,
  cameraState: null,
  progress: null,
  error: null
};

export function createModelPreviewController(
  options: ModelPreviewControllerOptions = {}
): ModelPreviewController {
  let snapshot: ModelPreviewState = { ...INITIAL_MODEL_STATE };
  const stateListeners = new Set<(s: ModelPreviewState) => void>();
  const mutate = (patch: Partial<ModelPreviewState>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const cb of stateListeners) cb(snapshot);
  };

  const eventListeners = new Set<(e: ModelViewerEvent) => void>();
  const emit = (e: ModelViewerEvent): void => {
    for (const cb of eventListeners) cb(e);
  };

  let engine: ModelViewer | null = null;
  let boundCanvas: RenderTargetCanvas | null = null;
  let unsubEngine: (() => void) | null = null;
  let disposed = false;
  /** Last source set — replayed when the canvas (re)binds so the model survives a remount. */
  let lastSource: ModelSourceInput | null = null;
  /** Control ops issued before the engine exists; replayed in order on bind. */
  const pendingOps: Array<(v: ModelViewer) => void> = [];
  /** Callers of `setSource` before the engine exists — settled by the replayed load. */
  const pendingSourceWaiters: Array<{ resolve: (i: ModelReadyInfo) => void; reject: (e: unknown) => void }> = [];

  const engineOptions = {
    ...(options.loaders ? { loaders: options.loaders } : {}),
    ...(options.background !== undefined ? { background: options.background } : {}),
    ...(options.interactionQuality ? { interactionQuality: options.interactionQuality } : {}),
    ...(options.cameraMode ? { cameraMode: options.cameraMode } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.filamentPalette ? { filamentPalette: options.filamentPalette } : {}),
    ...(options.renderScope ? { renderScope: options.renderScope } : {}),
    ...(options.createRenderer ? { createRenderer: options.createRenderer } : {}),
    ...(options.createControls ? { createControls: options.createControls } : {}),
    // Fold progress into state, then hand it to the consumer's callback.
    onProgress: (p: LoadProgress): void => {
      mutate({ progress: p, loading: p.stage !== 'ready' });
      options.onProgress?.(p);
    }
  };

  const applyReady = (info: ModelReadyInfo): void => {
    mutate({
      loading: false,
      ready: true,
      error: null,
      objectCount: info.objectCount,
      materials: info.materials,
      instancedCount: info.instancedCount,
      decimationApplied: info.decimationApplied,
      bounds: info.bounds,
      plates: info.plates ?? null,
      hasPlates: info.plates !== undefined
    });
  };

  const wire = (v: ModelViewer): void => {
    unsubEngine = v.onEvent((e) => {
      switch (e.type) {
        case 'ready':
          applyReady(e.info);
          break;
        case 'camera-changed':
          mutate({ cameraState: e.state });
          break;
        case 'error':
          mutate({ loading: false, error: { code: e.code, message: e.message } });
          break;
        case 'renderer-unsupported':
          mutate({ rendererSupported: false, error: { code: 'E_RENDERER_UNSUPPORTED', message: e.message } });
          break;
        default:
          break; // context-lost / context-restored: the engine self-recovers; no snapshot change
      }
      emit(e);
    });
  };

  function bindCanvas(canvas: RenderTargetCanvas | null): void {
    if (disposed || canvas === boundCanvas) return;
    // Tear down the engine bound to the previous canvas.
    if (engine !== null) {
      unsubEngine?.();
      unsubEngine = null;
      engine.dispose();
      engine = null;
    }
    boundCanvas = canvas;
    if (canvas === null) return;

    const v = createModelViewer(canvas, engineOptions);
    engine = v;
    wire(v);
    for (const op of pendingOps) op(v);
    pendingOps.length = 0;
    // Replay the last source so the model persists across a canvas rebind.
    if (lastSource !== null) {
      mutate({ loading: true, error: null });
      v.setSource(lastSource).then(
        (info) => {
          const waiters = pendingSourceWaiters.splice(0, pendingSourceWaiters.length);
          for (const w of waiters) w.resolve(info);
        },
        (err) => {
          const waiters = pendingSourceWaiters.splice(0, pendingSourceWaiters.length);
          for (const w of waiters) w.reject(err);
        }
      );
    }
  }

  const controls: ModelPreviewControls = {
    setSource(input) {
      lastSource = input;
      mutate({ loading: true, error: null });
      if (engine !== null) return engine.setSource(input);
      // No canvas yet: settle when the engine binds and replays this source.
      return new Promise<ModelReadyInfo>((resolve, reject) => {
        pendingSourceWaiters.push({ resolve, reject });
      });
    },
    setView(view) {
      if (engine !== null) engine.setView(view);
      else pendingOps.push((v) => v.setView(view));
    },
    getCameraState() {
      return engine !== null ? engine.getCameraState() : snapshot.cameraState;
    },
    setCameraState(state) {
      if (engine !== null) engine.setCameraState(state);
      else pendingOps.push((v) => v.setCameraState(state));
    },
    setBackground(bg) {
      if (engine !== null) engine.setBackground(bg);
      else pendingOps.push((v) => v.setBackground(bg));
    },
    setInteractionQuality(mode) {
      if (engine !== null) engine.setInteractionQuality(mode);
      else pendingOps.push((v) => v.setInteractionQuality(mode));
    },
    setRenderScope(scope) {
      if (engine !== null) engine.setRenderScope(scope);
      else pendingOps.push((v) => v.setRenderScope(scope));
    },
    frame() {
      if (engine !== null) engine.frame();
      else pendingOps.push((v) => v.frame());
    },
    resize(width, height) {
      if (engine !== null) engine.resize(width, height);
      else pendingOps.push((v) => v.resize(width, height));
    },
    capture(opts) {
      if (engine !== null) return engine.capture(opts);
      return Promise.reject(new Error('E_CAPTURE_UNSUPPORTED: no canvas bound'));
    }
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    unsubEngine?.();
    unsubEngine = null;
    engine?.dispose();
    engine = null;
    boundCanvas = null;
    stateListeners.clear();
    eventListeners.clear();
    pendingOps.length = 0;
    for (const w of pendingSourceWaiters.splice(0, pendingSourceWaiters.length)) {
      w.reject(new Error('E_MODEL_PREVIEW_DISPOSED'));
    }
  }

  return {
    bindCanvas,
    controls,
    getState: () => snapshot,
    onStateChange: (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    onEvent: (cb) => {
      eventListeners.add(cb);
      return () => eventListeners.delete(cb);
    },
    raw: { viewer: () => engine },
    dispose
  };
}
