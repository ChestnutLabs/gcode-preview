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
import { resolveTheme } from '@chestnutlabs/gcode-renderer-three';
import type {
  BuildVolumeDef,
  Theme,
  CameraState,
  CameraView,
  CaptureOptions,
  GLRendererLike,
  InteractiveStageOptions,
  LoadProgress,
  PixelRatioOption,
  RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import type { Confidence } from '@chestnutlabs/toolpath-core';
import {
  createModelViewer,
  type ModelViewer,
  type ModelViewerEvent,
  type ModelViewerOptions,
  type ModelReadyInfo
} from './model-viewer.js';
import type { ModelSourceInput, ModelLoader } from './loaders.js';
import { checkModelFov, checkModelPixelRatio, type ModelBackground, type PresentationView } from './model-renderer.js';
import type { ModelPlacement, PlacementOffset } from './placement.js';
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
  /** Re-fit the model on canvas resize until the user moves the camera (default `true`). */
  autoFrameOnResize?: boolean;
  /**
   * Build plate under the model (DD-032 §4.3): the full `BuildVolumeDef` (shape, `min`, excluded regions).
   * Omit/`null` for no plate — the viewer then renders exactly as before. Where the part sits on it is
   * reported honestly as `state.placement`.
   */
  buildVolume?: BuildVolumeDef | null;
  /**
   * Draw the build-volume wireframe cage over the plate (default `true`). `false` drops only the cage: the
   * plate, grid and shadow stay. Remembered across canvas rebinds.
   */
  showVolumeCage?: boolean;
  /**
   * Plate/backdrop look, e.g. `studioTheme('dark')`. Only the plate and backdrop fields apply; lights and
   * `materialPreset` are deliberately not applicable to the model viewer (its lighting is unchanged).
   * `theme.background` beats `background` (the fallback tier). Invalid values throw `RangeError` synchronously.
   */
  theme?: Theme;
  /** Perspective lens in degrees, [10, 120] (default 50). Throws `RangeError` synchronously outside it. */
  cameraFov?: number;
  /**
   * Resting pixel ratio of the canvas: a number in (0, 4], or `'device'` (the display's `devicePixelRatio`
   * capped at 2, followed live as it changes). Unset keeps the renderer's ratio (1). Sharper on HiDPI
   * screens, at a fill cost: a ratio of 2 shades 4× the fragments of 1. Throws `RangeError` synchronously
   * otherwise. The default `capture()` size does not change. Remembered across canvas rebinds.
   */
  pixelRatio?: PixelRatioOption;
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
  /**
   * How the model's position on the drawn plate is known (DD-032 §4.3): `'known'` (a Bambu/Orca project
   * whose parts lie on the bed), `'inferred'` (such a project, shifted by whole workspace cells),
   * `'approximated'` (anything else: centred on the bed at z = 0), or `null` — no plate is drawn (no
   * `buildVolume`, nothing shown, or the render scope spans more than one declared plate).
   */
  placement: ModelPlacement | null;
  /** The presentation offset applied to the model, mm (printer axes), to map authored ↔ drawn; `null` with no plate. `bounds` stays authored. */
  placementOffset: PlacementOffset | null;
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
  /** The fallback background tier: beaten by `theme.background` (DD-032), so it shows only while the theme sets none. */
  setBackground(bg: ModelBackground): void;
  /** Set or remove (`null`) the build plate; the model is re-placed and, while auto-framing, re-fitted. */
  setBuildVolume(def: BuildVolumeDef | null): void;
  /**
   * Show/hide the build-volume wireframe cage, independently of the plate (parity with the toolpath
   * `setBuildVolumeCage`). The model does not move. Remembered across plate rebuilds and canvas rebinds.
   */
  setBuildVolumeCage(visible: boolean): void;
  /** Replace the plate/backdrop theme (replace semantics). Throws `RangeError` synchronously for invalid values. */
  setTheme(theme: Theme): void;
  /** Change the perspective lens, [10, 120]°. Throws `RangeError` synchronously outside it, even before a canvas binds. Remembered across canvas rebinds. */
  setCameraFov(deg: number): void;
  /**
   * Change the resting pixel ratio: (0, 4] or `'device'` (DPR capped at 2, followed live). Throws
   * `RangeError` synchronously otherwise, even before a canvas binds. Remembered across canvas rebinds. A
   * gesture in progress settles on the new ratio; the default `capture()` size does not change.
   */
  setPixelRatio(ratio: PixelRatioOption): void;
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
  placement: null,
  placementOffset: null,
  cameraState: null,
  progress: null,
  error: null
};

export function createModelPreviewController(options: ModelPreviewControllerOptions = {}): ModelPreviewController {
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

  // The plate look and the lens are remembered here (not only in the engine), so a canvas rebind — a
  // StrictMode remount, a replaced canvas — rebuilds the engine with the latest values, not the initial ones.
  if (options.theme !== undefined) resolveTheme(options.theme); // invalid options fail synchronously
  if (options.cameraFov !== undefined) checkModelFov(options.cameraFov);
  let currentBuildVolume: BuildVolumeDef | null = options.buildVolume ?? null;
  let currentTheme: Theme | undefined = options.theme;
  let currentFov: number | undefined = options.cameraFov;
  let currentCage: boolean = options.showVolumeCage ?? true;
  if (options.pixelRatio !== undefined) checkModelPixelRatio(options.pixelRatio);
  let currentPixelRatio: PixelRatioOption | undefined = options.pixelRatio;

  const engineOptions = (): ModelViewerOptions => ({
    ...(options.loaders ? { loaders: options.loaders } : {}),
    ...(options.background !== undefined ? { background: options.background } : {}),
    ...(options.interactionQuality ? { interactionQuality: options.interactionQuality } : {}),
    ...(options.cameraMode ? { cameraMode: options.cameraMode } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.filamentPalette ? { filamentPalette: options.filamentPalette } : {}),
    ...(options.renderScope ? { renderScope: options.renderScope } : {}),
    ...(options.createRenderer ? { createRenderer: options.createRenderer } : {}),
    ...(options.createControls ? { createControls: options.createControls } : {}),
    ...(options.autoFrameOnResize !== undefined ? { autoFrameOnResize: options.autoFrameOnResize } : {}),
    ...(currentBuildVolume !== null ? { buildVolume: currentBuildVolume } : {}),
    ...(currentTheme !== undefined ? { theme: currentTheme } : {}),
    showVolumeCage: currentCage,
    ...(currentFov !== undefined ? { cameraFov: currentFov } : {}),
    ...(currentPixelRatio !== undefined ? { pixelRatio: currentPixelRatio } : {}),
    // Fold progress into state, then hand it to the consumer's callback.
    onProgress: (p: LoadProgress): void => {
      mutate({ progress: p, loading: p.stage !== 'ready' });
      options.onProgress?.(p);
    }
  });

  /** Mirror the engine's current plate placement into state after something that can change it. */
  const syncPlacement = (): void => {
    if (engine === null) return;
    const p = engine.getPlacement();
    const o = snapshot.placementOffset;
    const same =
      p.placement === snapshot.placement &&
      (p.placementOffset === null
        ? o === null
        : o !== null && o.x === p.placementOffset.x && o.y === p.placementOffset.y && o.z === p.placementOffset.z);
    if (!same) mutate({ placement: p.placement, placementOffset: p.placementOffset });
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
      hasPlates: info.plates !== undefined,
      placement: info.placement,
      placementOffset: info.placementOffset
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

  /** Detaches the bound canvas's size tracking (ResizeObserver + window-resize fallback). */
  let unsizeCanvas: (() => void) | null = null;

  /**
   * Keep the engine sized to a DOM canvas's CSS box, mirroring the toolpath controller: an initial fit,
   * a ResizeObserver, and a window-resize fallback (observers may never fire in embedded panes). A
   * zero-sized (hidden) canvas is skipped. OffscreenCanvas hosts size themselves via `controls.resize`.
   */
  const trackCanvasSize = (canvas: RenderTargetCanvas, v: ModelViewer): void => {
    const el = canvas as Partial<HTMLCanvasElement>;
    if (typeof el.getBoundingClientRect !== 'function') return;
    const fit = (): void => {
      const w = el.clientWidth ?? 0;
      const h = el.clientHeight ?? 0;
      if (w > 0 && h > 0) v.resize(w, h);
    };
    fit();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(canvas as HTMLCanvasElement);
    }
    const hasWindow = typeof window !== 'undefined';
    if (hasWindow) window.addEventListener('resize', fit);
    unsizeCanvas = () => {
      ro?.disconnect();
      if (hasWindow) window.removeEventListener('resize', fit);
    };
  };

  function bindCanvas(canvas: RenderTargetCanvas | null): void {
    if (disposed || canvas === boundCanvas) return;
    unsizeCanvas?.();
    unsizeCanvas = null;
    // Tear down the engine bound to the previous canvas.
    if (engine !== null) {
      unsubEngine?.();
      unsubEngine = null;
      engine.dispose();
      engine = null;
    }
    boundCanvas = canvas;
    if (canvas === null) return;

    const v = createModelViewer(canvas, engineOptions());
    engine = v;
    wire(v);
    trackCanvasSize(canvas, v);
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
    setBuildVolume(def) {
      currentBuildVolume = def;
      if (engine !== null) {
        engine.setBuildVolume(def);
        syncPlacement();
      }
    },
    setBuildVolumeCage(visible) {
      currentCage = visible;
      if (engine !== null) engine.setBuildVolumeCage(visible);
    },
    setTheme(theme) {
      resolveTheme(theme); // synchronous RangeError, before and after a canvas binds
      currentTheme = theme;
      if (engine !== null) engine.setTheme(theme);
    },
    setCameraFov(deg) {
      checkModelFov(deg);
      currentFov = deg;
      if (engine !== null) engine.setCameraFov(deg);
    },
    setPixelRatio(ratio) {
      checkModelPixelRatio(ratio);
      currentPixelRatio = ratio;
      if (engine !== null) engine.setPixelRatio(ratio);
    },
    setInteractionQuality(mode) {
      if (engine !== null) engine.setInteractionQuality(mode);
      else pendingOps.push((v) => v.setInteractionQuality(mode));
    },
    setRenderScope(scope) {
      if (engine !== null) {
        engine.setRenderScope(scope);
        syncPlacement();
      } else pendingOps.push((v) => v.setRenderScope(scope));
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
    unsizeCanvas?.();
    unsizeCanvas = null;
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
