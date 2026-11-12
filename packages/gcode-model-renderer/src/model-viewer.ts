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
import { Scene } from 'three';
import {
  CaptureUnsupportedError,
  InteractiveStage,
  createDefaultGLRenderer,
  resolveTheme,
  type Backdrop,
  type BuildVolumeDef,
  type Theme,
  type CameraMode,
  type CameraState,
  type CameraView,
  type CaptureOptions,
  type GLRendererLike,
  type InteractiveStageOptions,
  type LoadProgress,
  type PixelRatioOption,
  type RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import type { Confidence } from '@chestnutlabs/toolpath-core';
import { ModelContent } from './model-content.js';
import { DEFAULT_MODEL_LOADERS, resolveModelScene, type ModelLoader, type ModelSourceInput } from './loaders.js';
import { ModelParseError, type ModelLimits } from './limits.js';
import { checkModelFov, checkModelPixelRatio, type ModelBackground, type PresentationView } from './model-renderer.js';
import { ModelPlate, applyModelBackground } from './model-plate.js';
import type { ModelPlacement, PlacementOffset } from './placement.js';
import {
  applyRenderScope,
  checkRenderScope,
  sceneInstanceCount,
  type ModelBounds,
  type ModelPlateSummary,
  type ModelScene,
  type RenderScope
} from './scene-model.js';

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
  /** Initial render scope (DD-030 D2) — e.g. `{ plateId: 3 }`. Omit to render the whole source. */
  renderScope?: RenderScope;
  /**
   * Staged loading-progress callback (DD-024): typed `stage`/`done`/`total`/`unit` events (no human copy),
   * each tagged with the load `generation` so a consumer drops events from a superseded `setSource`. The
   * consumer owns all wording/i18n. Events from a superseded load are not emitted.
   */
  onProgress?: (progress: LoadProgress) => void;
  /**
   * Re-fit the camera to the model when the canvas is resized (`resize()`), until the user moves the
   * camera (orbit/zoom/pan or `setCameraState`); after that their view is kept. `frame()` (Reset view),
   * a new source, or a render-scope change resumes auto-framing. Default `true`.
   */
  autoFrameOnResize?: boolean;
  /**
   * Build plate under the model (DD-032 §4.3) — the full `BuildVolumeDef` (shape, `min`, excluded regions).
   * Omit/`null` for no plate: the viewer then renders exactly as before. Where the part sits on the plate is
   * decided honestly and reported as `placement` (see {@link ModelPlacement}).
   */
  buildVolume?: BuildVolumeDef | null;
  /**
   * Draw the build-volume wireframe cage over the plate. Default `true`. `false` keeps the plate, its grid and
   * the contact shadow and drops only the cage, as the toolpath viewer's `setBuildVolumeCage(false)` does.
   */
  showVolumeCage?: boolean;
  /**
   * Plate/backdrop look (DD-032), e.g. `studioTheme('dark')`. Only the plate and backdrop fields apply
   * (`background`, `gridColor`, `gridOpacity`, `gridMajor`, `bedOutline`, `bedSurface`, `bedColor`,
   * `contactShadow`); lights and `materialPreset` are deliberately not applicable — the model rig is unchanged.
   * `theme.background` beats `background`, which is the fallback tier.
   */
  theme?: Theme;
  /** Perspective lens in degrees, [10, 120] (default 50). Throws `RangeError` outside it. */
  cameraFov?: number;
  /**
   * Resting pixel ratio of the canvas: a number in (0, 4], or `'device'` (the display's `devicePixelRatio`
   * capped at 2, followed live). Unset keeps the renderer's ratio (1). A ratio of 2 shades 4× the fragments
   * of 1. Throws `RangeError` synchronously otherwise. The default `capture()` size does not change.
   */
  pixelRatio?: PixelRatioOption;
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
  /** How the plate placement was decided (DD-032 §4.3); `null` when no plate is drawn. */
  placement: ModelPlacement | null;
  /** The presentation offset applied to the model, mm (printer axes); `null` when no plate is drawn. */
  placementOffset: PlacementOffset | null;
  // Reserved additive extension (not v1): `objects?: { name?: string; materials?: Confidence }[]`.
}

export type ModelViewerEvent =
  | { type: 'ready'; info: ModelReadyInfo }
  /** Fires once per user camera gesture (orbit/zoom/pan) after it settles — never for programmatic moves. */
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
  /**
   * The fallback background tier (DD-032): beaten by a `theme.background`, so after `setTheme` with a theme
   * that sets one this has no visible effect until that theme's `background` is cleared.
   */
  setBackground(bg: ModelBackground): void;
  /** Set or remove (`null`) the build plate. Re-places the model and, while auto-framing, re-fits the camera. */
  setBuildVolume(def: BuildVolumeDef | null): void;
  /**
   * Show/hide the build-volume wireframe cage, independently of the plate, grid and shadow (parity with the
   * toolpath `setBuildVolumeCage`). The model does not move and the camera is not re-fitted. Remembered when the
   * plate is rebuilt (a new bed, theme or scope).
   */
  setBuildVolumeCage(visible: boolean): void;
  /** Replace the plate/backdrop theme (replace semantics). Throws `RangeError` for an invalid opacity/`every`. */
  setTheme(theme: Theme): void;
  /** Change the perspective lens, [10, 120]° (`RangeError` outside it). Keeps apparent size; re-fits while auto-framing. */
  setCameraFov(fov: number): void;
  /**
   * Change the resting pixel ratio: (0, 4] or `'device'` (DPR capped at 2, followed live). `RangeError`
   * otherwise. A gesture in progress settles on the new ratio; the default `capture()` size does not change.
   */
  setPixelRatio(ratio: PixelRatioOption): void;
  /** The current plate placement decision (`null` placement = no plate drawn). */
  getPlacement(): { placement: ModelPlacement | null; placementOffset: PlacementOffset | null };
  setInteractionQuality(mode: 'off' | 'auto'): void;
  resize(width: number, height: number): void;
  /**
   * Re-fit the camera to the current model bounds (the default 3/4 view), fitting the bounding box to
   * the canvas aspect and field of view. Also resumes auto-framing on resize.
   */
  frame(): void;
  /**
   * Render only a subset of the current source (DD-030 D2): `{ plateId }`, `{ objectIds }`, or an
   * `{ instanceFilter }`; `null` restores the whole source. Rebuilds and reframes to the subset. Gate a
   * `{ plateId }` on the ready info's `plates` being present — an unmatched scope renders empty.
   */
  setRenderScope(scope: RenderScope | null): void;
  /**
   * Capture the current view as an image `Blob` (DD-030 D1) — for an operator-selected thumbnail or a
   * large-file fallback. Rejects with `E_CAPTURE_UNSUPPORTED` when the renderer is unavailable.
   */
  capture(opts?: CaptureOptions): Promise<Blob>;
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  dispose(): void;
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
  // The fallback background tier (DD-032): beaten by `theme.background`, beaten in turn by a capture override.
  let fallbackBackground: ModelBackground = options.background ?? 'transparent';
  let theme: Theme | undefined = options.theme;
  // Invalid look/lens options fail synchronously, at construction, before any GL work.
  if (theme !== undefined) resolveTheme(theme);
  if (options.cameraFov !== undefined) checkModelFov(options.cameraFov);
  if (options.pixelRatio !== undefined) checkModelPixelRatio(options.pixelRatio);
  if (options.renderScope !== undefined) checkRenderScope(options.renderScope);

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
  let backdrop: Backdrop | null = applyModelBackground(scene, theme, fallbackBackground, null);
  const content = new ModelContent(scene);
  const plate = new ModelPlate(scene, options.buildVolume ?? null, theme, options.showVolumeCage ?? true);

  // Retained so context-loss recovery can rebuild meshes from the last-set scene.
  let currentScene: ModelScene | null = null;
  // Active render scope (DD-030 D2); applied to `currentScene` on build/reframe/restore. Null = whole source.
  let currentScope: RenderScope | null = options.renderScope ?? null;
  let disposed = false;
  /** The scene to actually build/render = the full source narrowed by the active scope. */
  const scopedScene = (): ModelScene | null =>
    currentScene === null ? null : currentScope ? applyRenderScope(currentScene, currentScope) : currentScene;
  // Monotonic token for last-wins overlapping setSource (stale async results are discarded).
  let sourceToken = 0;

  const autoFrameOnResize = options.autoFrameOnResize ?? true;
  // True while the camera is library-framed; a user gesture (or setCameraState) hands it to the user.
  let autoFraming = true;

  let stage: InteractiveStage | null = null;
  /** Fit the current model's box to the viewport (aspect + FOV aware); `keepDirection` keeps the view angle. */
  const fit = (keepDirection = false): void => {
    const f = content.framing;
    if (f === null || stage === null) return;
    stage.fitBox(f.sceneMin, f.sceneMax, keepDirection ? { direction: stage.viewDirection() } : {});
  };
  /** Re-place the model on the plate for the current scene/scope/bed/theme (rebuilds the plate + shadow). */
  const replate = (): void => {
    plate.update(content, currentScene, scopedScene(), currentScope);
  };
  try {
    stage = new InteractiveStage({
      canvas,
      scene,
      cameraMode: options.cameraMode ?? 'perspective',
      interactionQuality: options.interactionQuality ?? 'auto',
      ...(options.pixelRatio !== undefined ? { pixelRatio: options.pixelRatio } : {}),
      createRenderer: options.createRenderer ?? ((c) => createDefaultGLRenderer(c, { alpha: true })),
      ...(options.createControls ? { createControls: options.createControls } : {}),
      onCameraChanged: (state) => emit({ type: 'camera-changed', state }),
      onInteractionStart: () => {
        autoFraming = false;
      },
      onContextLost: () => emit({ type: 'context-lost' }),
      onContextRestored: () => {
        // GPU resources are gone; rebuild meshes from the retained scene and reframe, mirroring the
        // toolpath renderer's recovery.
        const shown = scopedScene();
        if (shown !== null && stage !== null) {
          content.setScene(shown);
          replate(); // the plate's textures/geometry are GPU resources too: rebuild, freeing the old
          if (autoFraming) fit(true);
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
  if (stage !== null && options.cameraFov !== undefined) stage.setFov(options.cameraFov);

  async function setSource(input: ModelSourceInput): Promise<ModelReadyInfo> {
    const my = ++sourceToken;
    // Progress is generation-scoped (DD-024 §4 D5): only emit while THIS load is current, so a superseded
    // load can never advance the next load's progress. Typed fields only — no human copy.
    const onProgress = options.onProgress;
    const progress = (p: Omit<LoadProgress, 'generation'>): void => {
      if (onProgress !== undefined && my === sourceToken && !disposed) onProgress({ ...p, generation: my });
    };
    if (stage === null || disposed) {
      const message = disposed ? 'model viewer is disposed' : 'WebGL renderer unavailable';
      emit({ type: 'error', code: 'E_MODEL_RENDERER_UNAVAILABLE', message });
      throw new ModelParseError('E_MODEL_RENDERER_UNAVAILABLE', message);
    }
    try {
      // Parse/resolve is a single opaque async step here (unzip + XML parse); its total is unknown ⇒ honest
      // indeterminate, not a fabricated bar. Finer parse-stage counts are a later phase (threading into the
      // loader/parser); Phase A closes the biggest gap — the model renderer had NO progress at all.
      progress({ stage: 'parsing', indeterminate: true });
      const parsed = await resolveModelScene(input, loaders, limits, filamentPalette ? { filamentPalette } : undefined);
      const info: ModelReadyInfo = {
        objectCount: parsed.objects.length,
        materials: parsed.capabilities.materials,
        bounds: parsed.bounds,
        instancedCount: sceneInstanceCount(parsed),
        decimationApplied: 1,
        placement: null,
        placementOffset: null
      };
      if (parsed.plates !== undefined) info.plates = parsed.plates;
      // Last-wins: a newer setSource (or a dispose) superseded this one — discard without mutating.
      if (my !== sourceToken || disposed || stage === null) return info;

      currentScene = parsed;
      const shown = scopedScene()!; // parsed just set → non-null
      const total = shown.objects.length;
      progress({ stage: 'building-geometry', done: 0, total, unit: 'objects' });
      content.setScene(shown, (done) => progress({ stage: 'building-geometry', done, total, unit: 'objects' }));
      replate();
      info.placement = plate.getPlacement().placement;
      info.placementOffset = plate.getPlacement().placementOffset;
      autoFraming = true;
      fit();
      progress({ stage: 'ready' });
      emit({ type: 'ready', info });
      return info;
    } catch (err) {
      const code = err instanceof ModelParseError ? err.code : 'E_MODEL_PARSE';
      const message = err instanceof Error ? err.message : String(err);
      // Loader/limit failures surface as an event, never thrown out of the render loop (DD §6) — but the
      // returned promise still rejects so an awaiting caller sees the failure.
      // A superseded (or disposed) load reports to its own caller only: its failure must not land as an
      // error event after the newer load's `ready`.
      if (my === sourceToken && !disposed) emit({ type: 'error', code, message });
      throw err;
    }
  }

  return {
    setSource,
    setView(view) {
      stage?.setView(view as CameraView);
      // While library-framed, a preset view is fitted too (and stays fitted across resizes).
      if (autoFraming) fit(true);
    },
    getCameraState() {
      return stage ? stage.getCameraState() : null;
    },
    setCameraState(state) {
      autoFraming = false;
      stage?.setCameraState(state);
    },
    setBackground(bg) {
      fallbackBackground = bg;
      backdrop = applyModelBackground(scene, theme, fallbackBackground, backdrop);
      stage?.render();
    },
    setBuildVolume(def) {
      plate.setBuildVolume(def);
      replate();
      // The presented bounds moved (new bed ⇒ new offset): while library-framed, re-fit to them.
      if (autoFraming) fit(true);
      stage?.render();
    },
    setBuildVolumeCage(visible) {
      plate.setCageVisible(visible);
      stage?.render();
    },
    setTheme(next) {
      resolveTheme(next); // throws before anything changes
      theme = next;
      plate.setTheme(next);
      backdrop = applyModelBackground(scene, theme, fallbackBackground, backdrop);
      replate();
      stage?.render();
    },
    setCameraFov(fov) {
      checkModelFov(fov);
      stage?.setFov(fov);
      // Exact re-fit while library-framed (instead of the dolly), and auto-framing stays on.
      if (autoFraming) fit(true);
    },
    setPixelRatio(ratio) {
      checkModelPixelRatio(ratio);
      stage?.setPixelRatio(ratio);
    },
    getPlacement() {
      const p = plate.getPlacement();
      return { placement: p.placement, placementOffset: p.placementOffset };
    },
    setInteractionQuality(mode) {
      stage?.setInteractionQuality(mode);
    },
    resize(width, height) {
      stage?.resize(width, height);
      // A hidden (0×0) canvas has no aspect to fit; keep the pose and re-fit on the next real size.
      if (autoFrameOnResize && autoFraming && width > 0 && height > 0) fit(true);
    },
    frame() {
      autoFraming = true;
      fit();
    },
    setRenderScope(scope) {
      if (scope !== null) checkRenderScope(scope); // throws before anything changes
      currentScope = scope;
      const shown = scopedScene();
      if (shown === null || stage === null) return; // no source yet — applied on the next setSource
      content.setScene(shown);
      replate();
      autoFraming = true;
      fit();
    },
    async capture(opts) {
      if (stage === null) {
        throw new CaptureUnsupportedError('model viewer renderer unavailable');
      }
      // includeBuildVolume:false hides the plate and its shadow for the off-screen render only (DD-032 §4.3).
      // The stage calls the borrow synchronously before the render and undoes it right after readback, so the
      // plate is never hidden across the encode await (a live frame or overlapping capture still sees it).
      return await stage.capture(opts, opts?.includeBuildVolume === false ? () => plate.hide() : undefined);
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
      plate.dispose();
      backdrop?.dispose();
      backdrop = null;
      content.dispose();
      listeners.clear();
    }
  };
}
