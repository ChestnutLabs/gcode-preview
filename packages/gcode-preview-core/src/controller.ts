/**
 * createPreviewController — the framework-neutral engine glue (DD-007 §4.6, phase 5,
 * issue #112): GcodeParseSession (worker parse) + ToolpathRenderer (scene) +
 * createProgressMapper (DD-006), extracted from the Vue composable so every framework
 * adapter is a pure reactivity bridge over ONE implementation.
 *
 * State model: immutable snapshots. Every change replaces `getState()`'s return value
 * and notifies subscribers — exactly what React's useSyncExternalStore, Svelte stores,
 * and Vue reactive mirrors all consume without adaptation. Snapshots carry summaries
 * only (numbers/strings): IR/typed arrays NEVER enter the state model.
 */
import {
  GcodeParseSession,
  CancelledError,
  ParseSessionError,
  type ParseProgress,
  type ParseResult,
  type SessionOptions,
  type WireParseOptions
} from '@chestnutlabs/gcode-parser';
import type {
  BuildVolumeDef,
  CameraMode,
  CameraState,
  CameraView,
  CaptureOptions,
  ColorMode,
  GLRendererLike,
  PixelRatioOption,
  ProgressPresentationMode,
  ProgressivePreview,
  QualityMode,
  QualityPolicy,
  RenderStats,
  RenderTargetCanvas,
  Theme,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import { CaptureUnsupportedError } from '@chestnutlabs/gcode-renderer-three';
import { LayerView2DRenderer } from './renderer-2d-adapter.js';
import { checkColorMode } from '@chestnutlabs/gcode-renderer-2d';
import type { MoveKindToggle, PreviewRenderer, PreviewRendererEvent, RendererMode } from './renderer-interface.js';
import {
  createProgressMapper,
  computeToolpathTime,
  segmentsCompletedAtTime,
  type Confidence,
  type DialectMetadata,
  type FeatureRoleValue,
  type MachineGeometry,
  type MappedProgress,
  type ProgressMapper,
  type ProgressObservation,
  type ToolpathIR,
  type ToolpathTime,
  type Warning
} from '@chestnutlabs/toolpath-core';
import { resolveColorMode } from './color-resolve.js';
import { checkCameraFov, checkPixelRatio } from './lens.js';

/** Session/renderer events, re-emitted, plus the controller's own lifecycle events. */
export type PreviewEvent =
  | PreviewRendererEvent
  | { type: 'parse-started'; bytes: number }
  | { type: 'parse-progress'; progress: ParseProgress }
  | {
      type: 'parse-complete';
      segments: number;
      layers: number;
      complete: boolean;
      /** Per-field capability confidence (DD-001) — lets consumers gate their own UI honestly (#275/M3). */
      capabilities: Record<string, Confidence>;
      /** Parse warnings (codes/messages), so consumers can surface disclosures without the raw handle. */
      warnings: readonly Warning[];
      /**
       * Slicer-reported metadata (per-tool `filaments`, `filamentUsage`, `printEstimate`, `thumbnails`,
       * `dialects`, whitelisted `raw`) — for a consumer "Slice details" panel without the raw handle
       * (#306/#4). Capability-honest: `undefined` when the file carried none; individual fields are
       * absent (not fabricated) when a slicer didn't emit them. Purge/tower/cost are not parsed.
       */
      metadata: DialectMetadata | undefined;
    }
  | { type: 'parse-cancelled' }
  | { type: 'parse-error'; code: string; message: string }
  | {
      /** File-discovered geometry NOT auto-applied because the consumer configured a
       *  volume (DD-005 consumer-wins precedence) — the host decides. */
      type: 'machine-geometry-discovered';
      machine: MachineGeometry;
    };

export interface PreviewControllerOptions {
  /** Custom worker factory (DD-005 slim/custom entries). Default: the batteries worker. */
  createWorker?: SessionOptions['worker'];
  renderer?: {
    /**
     * Renderer implementation (DD-014 D5): `'3d'` (default) is the Three.js renderer; `'2d'` is the
     * low-resource Canvas 2D layer view. The 3D renderer is loaded on demand, so a `'2d'` consumer's
     * bundle never pulls Three.js. 3D-only options below are ignored (and disclosed) in `'2d'`.
     */
    mode?: RendererMode;
    buildVolume?: BuildVolumeDef;
    quality?: QualityMode | 'auto';
    /**
     * Fidelity policy (DD-023 §4 D6): 'full' (complete representation, no auto-decimation / no tubes→lines),
     * 'adaptive' (default; capability-aware auto reduction, disclosed), 'fast' (flat lines). Distinct from
     * the geometry `quality` tier. 3D only.
     */
    qualityMode?: QualityPolicy;
    /**
     * During-parse preview presentation (#60 curtain): 'lines' (default, stream the progressive line
     * preview), 'hold' (keep progress events but reveal only the final coloured build — a single clean
     * reveal), or 'off' (no progressive geometry or preview progress; drive your own loading treatment).
     * `parse-progress` events flow in every mode. 3D only.
     */
    progressivePreview?: ProgressivePreview;
    /** Camera projection (#150, DD-009 D3); default 'perspective'. 3D only. */
    cameraMode?: CameraMode;
    /**
     * Perspective lens: vertical field of view in degrees (DD-032 §4.2), default 50. Framing reads it,
     * so the framed content fits at any lens. Must be in [10, 120]: anything else throws `RangeError`
     * from {@link createPreviewController} (never clamped). Kept across canvas rebinds. 3D only.
     */
    cameraFov?: number;
    /**
     * Resting pixel ratio of the interactive canvas (drawing-buffer pixels per CSS pixel). Unset keeps
     * the renderer's own ratio (1). A number in (0, 4], or `'device'`: the display's `devicePixelRatio`
     * capped at 2, followed live as it changes (another monitor, browser zoom). Sharper on HiDPI screens,
     * at a fill cost: a ratio of 2 shades 4× the fragments of 1. Anything else throws `RangeError` from
     * {@link createPreviewController} (never clamped). Interaction quality still reduces it while the
     * camera moves. The default `capture()` size does not change. Kept across canvas rebinds. 3D only.
     */
    pixelRatio?: PixelRatioOption;
    /** Framing target (#306/#6): 'all' extrusion (default) or the printed 'object'. 3D only. */
    frameContent?: 'object' | 'all';
    /** Interaction-aware quality (#306/2, DD-020): 'auto' reduces detail while moving. 3D only. */
    interactionQuality?: 'off' | 'auto';
    colorMode?: ColorMode;
    tube?: TubeOptions;
    /** Bounded declarative theme (#153, DD-009 D4). 3D only. */
    theme?: Theme;
    /** 2D only: preceding "ghost" layers drawn beneath the active one (default 1, floor 0). */
    adjacentLayers?: number;
    /** 2D only: ghost-layer opacity (default 0.25). */
    ghostOpacity?: number;
    /** Parallel tube-geometry build (DD-028). Default `'auto'` (engages a capability+memory-aware pool
     *  for large tube builds in a browser); `'off'` forces the synchronous path. 3D only. */
    geometryConcurrency?: 'auto' | 'off' | number;
    /** Max in-flight tube-geometry bytes for the parallel build (DD-028 memory backpressure). 3D only. */
    geometryMemoryBudgetBytes?: number;
    /** Advanced/test injectables — pass-throughs of the renderer's own contract (3D only). */
    createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
    scheduleFrame?: (cb: () => void) => void;
    chunksPerTick?: number;
  };
  /** Applied to every parse unless overridden per-call. */
  parseDefaults?: WireParseOptions;
}

/** `parse()` never rejects from prop/event-driven flows (DD-007 §6): inspect the outcome. */
export type ParseOutcome =
  | { ok: true; result: ParseResult }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: { code: string; message: string } };

export interface GcodePreviewState {
  parsing: boolean;
  parseProgress: ParseProgress | null;
  /** Summary of the last successful parse — plain numbers/strings, never typed arrays. */
  summary: {
    segments: number;
    layers: number;
    complete: boolean;
    stopReason: string | undefined;
    capabilities: Record<string, Confidence>;
    warnings: number;
  } | null;
  metadata: DialectMetadata | undefined;
  activeQuality: QualityMode | null;
  presentation: ProgressPresentationMode;
  layerCount: number;
  segmentCount: number;
  /**
   * User-presentable disclosure of what the current build leaves out (empty when it draws everything):
   * decimation (3D), then the count of segments skipped for a non-finite coordinate (#518), e.g.
   * `"3 segments with a non-finite coordinate were not drawn."`. Updated on every `buildComplete`.
   */
  disclosure: string;
  /**
   * Estimated total print time in ms (#181), or null before a parse. `timeEstimateSource` says whether
   * it's the slicer's own estimate (`'slicer'`, trustworthy) or a kinematic approximation
   * (`'kinematic'`, constant-velocity, slightly low — disclose when shown).
   */
  totalTimeMs: number | null;
  timeEstimateSource: 'slicer' | 'kinematic' | null;
  /**
   * Which color modes the current file can actually support (DD-031 G6) — the capability-aware list a
   * consumer UI should offer, so it can gray out (and explain) the rest rather than fabricating colors.
   * Empty before a parse / before the renderer is ready. `single`/`tool`/`moveKind` are always present.
   */
  availableColorModes: ColorModeName[];
  /** True when the current file carries retraction/deretraction events the markers can show (DD-031 G6). */
  hasRetractions: boolean;
  /** True when the current file carries M600 color-change boundaries (DD-031 G6). */
  hasColorChanges: boolean;
  error: { code: string; message: string } | null;
}

/** The discriminant of {@link ColorMode} — the color-mode identifiers, for capability lists. */
export type ColorModeName = ColorMode['mode'];

/** Every color mode the engine can render, in menu order — the domain `availableColorModes` filters. */
export const ALL_COLOR_MODES: readonly ColorModeName[] = [
  'single',
  'tool',
  'feature',
  'colorChange',
  'filament',
  'feedrate',
  'object',
  'layerHeight',
  'power',
  'moveKind'
];

/**
 * Preview controls. A call made before the renderer is ready (the 3D renderer loads on demand) is queued
 * and replayed in order once it binds. Where a control validates its argument in core (the layer, scrub
 * and lens controls, `setPixelRatio`, `setColorMode`), a bad argument throws `RangeError` to the caller at
 * once, queued or not. A value only the renderer can check (`setTheme`, `setBuildVolume`) throws to the
 * caller when the renderer is bound; if the call was queued, the replay reports it as `state.error` plus
 * an `error` event with code `E_CONTROL_REJECTED` (the message names the control), and the calls queued
 * after it still apply.
 */
export interface GcodePreviewControls {
  /**
   * Clip to an inclusive layer range. Throws `RangeError` for a non-number or NaN end (±Infinity is an
   * open end).
   */
  setLayerRange(startLayer: number, endLayer: number): void;
  /** Cut the toolpath after segment `segIndex` (inclusive); null clears. Throws `RangeError` for NaN. */
  setScrubPosition(segIndex: number | null): void;
  /**
   * Time-based scrub (#181): cut the toolpath at print time `ms` (kinematic axis). null clears the
   * cut. Resolves to a segment-index scrub; any other call before a successful parse is a no-op (an
   * existing cut stays). Throws `RangeError` for a non-number or NaN.
   */
  setScrubTime(ms: number | null): void;
  setKindVisible(kind: MoveKindToggle, visible: boolean): void;
  /**
   * Show/hide a single feature role — e.g. hide `Skirt`/`Brim` to declutter a part preview. Gate the
   * UI on `capabilities.featureRoles === 'known'` (like the feature color mode); a no-op on the 2D
   * renderer and on files without feature annotations. Import `FeatureRole` from `@chestnutlabs/toolpath-core`.
   */
  setFeatureRoleVisible(role: FeatureRoleValue, visible: boolean): void;
  /** Opt-in retraction/deretraction markers (DD-009 D1, #148). Off by default. */
  setShowRetractions(visible: boolean): void;
  setColorMode(mode: ColorMode): boolean;
  setQuality(quality: QualityMode | 'auto'): void;
  /** Set the fidelity policy (DD-023 §4 D6): 'full' | 'adaptive' | 'fast'. 3D only. */
  setQualityMode(mode: QualityPolicy): void;
  /** Set the during-parse preview curtain (#60): 'lines' | 'hold' | 'off'. Applies to the next parse. 3D only. */
  setProgressivePreview(mode: ProgressivePreview): void;
  /** Switch camera projection (#150, DD-009 D3). */
  setCameraMode(mode: CameraMode): void;
  /**
   * Change the perspective lens (DD-032 §4.2), degrees. The camera dollies to keep the framing, without
   * a re-fit and without a `camera-changed` event; while orthographic the lens is remembered and
   * applied on the switch back. Throws `RangeError` synchronously outside [10, 120] (never clamped),
   * even before the 3D renderer has loaded. Kept across canvas rebinds. The 2D renderer discloses
   * this via `renderer-unsupported`.
   */
  setCameraFov(fov: number): void;
  /**
   * Change the resting pixel ratio: a number in (0, 4], or `'device'` (DPR capped at 2, followed live).
   * A gesture in progress keeps its interaction-quality reduction and settles on the new ratio. Throws
   * `RangeError` synchronously otherwise (never clamped), even before the 3D renderer has loaded. Kept
   * across canvas rebinds. The default `capture()` size does not change; pass `width`/`height` for a
   * crisper image. The 2D renderer discloses this via `renderer-unsupported`.
   */
  setPixelRatio(ratio: PixelRatioOption): void;
  /** Snap to a preset orientation — top/front/iso/… (#268). Instant; preserves the projection.
   *  The 2D renderer discloses this via `renderer-unsupported` rather than moving. */
  setView(view: CameraView): void;
  /** Read the current camera as a serializable snapshot (#268), or null before the renderer is ready
   *  / on the 2D renderer (which has no 3D pose). */
  getCameraState(): CameraState | null;
  /** Restore a camera snapshot verbatim (#268) — no re-fit to the current model. 2D discloses. */
  setCameraState(state: CameraState): void;
  /**
   * Apply a bounded declarative theme (#153, DD-009 D4). The 3D renderer throws `RangeError` for an
   * out-of-range opacity or `gridMajor.every`; queued before bind, that is `E_CONTROL_REJECTED` instead.
   */
  setTheme(theme: Theme): void;
  /**
   * Marks the volume consumer-configured: file-discovered geometry stops auto-applying. The 3D renderer
   * throws `RangeError` for a volume it cannot draw; queued before bind, that is `E_CONTROL_REJECTED`.
   */
  setBuildVolume(def: BuildVolumeDef | MachineGeometry): void;
  /** Show/hide the build-volume wireframe cage independently of the bed/plate (#306/#6). */
  setBuildVolumeCage(visible: boolean): void;
  /** Frame the printed 'object' (excl. skirt/prime) vs 'all' extrusion, and re-frame (#306/#6). */
  setFrameContent(mode: 'object' | 'all'): void;
  /** Interaction-aware quality: 'auto' reduces detail while the camera moves (#306/2, DD-020). */
  setInteractionQuality(mode: 'off' | 'auto'): void;
  frame(): void;
  /**
   * Capture the currently displayed view as an image `Blob` (DD-030 D1) — for a user-selected thumbnail,
   * a large-file fallback, or a screenshot. Rejects with `E_CAPTURE_UNSUPPORTED` before the 3D renderer
   * is ready or on the 2D renderer (which cannot render-to-target). The caller owns the `Blob`.
   */
  capture(opts?: CaptureOptions): Promise<Blob>;
  /**
   * Render diagnostics snapshot (DD-027, DD-031 G1) — backend, WebGL version, GPU (hardware/software),
   * geometry mode, build parallelism + worker count, draw calls, tube-byte budget, and parse/build/
   * first-frame timings — or null before the first render and on the 2D renderer (which produces none).
   * Reachable through the public surface so a diagnostics panel needs no `raw.renderer()`.
   */
  getRenderStats(): RenderStats | null;
  /**
   * Pick the IR segment under a pointer in normalized device coords ([-1, 1], y up), or null (DD-031 G2,
   * #184). Powers source-mapping/inspection UI. The 3D renderer raycasts the toolpath; the 2D renderer
   * returns null (no picking yet). `threshold` widens the hit test (world units).
   */
  pickSegment(ndcX: number, ndcY: number, threshold?: number): number | null;
  /**
   * Capability gate for a color mode against the current file (DD-031 G6) — mirrors
   * {@link GcodePreviewState.availableColorModes} for a one-off query. `false` when the file lacks the
   * channel the mode reads; always `true` before a parse (optimistic, like `setColorMode`).
   */
  isColorModeAvailable(mode: ColorModeName): boolean;
}

export interface PreviewController {
  /** Bind/rebind the renderer to a canvas (null unbinds). Rebinding disposes safely. */
  bindCanvas(canvas: HTMLCanvasElement | null): void;
  /**
   * Parse a file. Event contract: every `parse-started` is followed by exactly one terminal event
   * (`parse-complete`, `parse-error` or `parse-cancelled`). A call superseded by a newer `parse()` is
   * `parse-cancelled` (even if it failed or finished first) and resolves `{ ok: false, cancelled: true }`;
   * a superseded call that never started (it was waiting on the running parse) emits no event.
   */
  parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome>;
  cancel(): void;
  /** DD-006: map one observation and drive the overlay. Null before a successful parse. */
  observeProgress(obs: ProgressObservation): MappedProgress | null;
  /** Recompute staleness (DD-006 §4.4.3) — call at ~1 Hz while telemetry may go quiet. */
  tickProgress(nowMs: number): MappedProgress | null;
  clearProgress(): void;
  /** Current immutable state snapshot (identity changes on every state change). */
  getState(): GcodePreviewState;
  /**
   * Subscribe to snapshot replacements. Returns the unsubscriber. A subscriber that throws does not
   * stop the other subscribers or change a parse outcome: its error is re-thrown from a microtask.
   */
  onStateChange(cb: (state: GcodePreviewState) => void): () => void;
  controls: GcodePreviewControls;
  /**
   * Escape hatches — the neutral objects themselves (advanced use). `renderer()` returns the active
   * {@link PreviewRenderer} (the 3D `ToolpathRenderer` or the 2D `LayerView2DRenderer`), or null
   * before bind / during the 3D renderer's on-demand load.
   */
  raw: { session: GcodeParseSession; renderer: () => PreviewRenderer | null };
  /** Subscribe to events. Returns the unsubscriber. A throwing subscriber is isolated like {@link onStateChange}'s. */
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  dispose(): void;
}

const INITIAL_STATE: GcodePreviewState = {
  parsing: false,
  parseProgress: null,
  summary: null,
  metadata: undefined,
  activeQuality: null,
  presentation: 'hidden',
  layerCount: 0,
  segmentCount: 0,
  disclosure: '',
  totalTimeMs: null,
  timeEstimateSource: null,
  availableColorModes: [],
  hasRetractions: false,
  hasColorChanges: false,
  error: null
};

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** English ordinal for the decimation disclosure ("every 3rd", not "every 3th"). */
function ordinal(n: number): string {
  const rem100 = n % 100;
  const rem10 = n % 10;
  const suffix =
    rem100 >= 11 && rem100 <= 13 ? 'th' : rem10 === 1 ? 'st' : rem10 === 2 ? 'nd' : rem10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/**
 * Call every subscriber with `value`. A subscriber that throws cannot stop the others or the controller's
 * own work (a parse's outcome, the rest of an event sequence): its error is re-thrown from a microtask, so
 * it surfaces as an uncaught error and is never swallowed.
 */
function notifyAll<T>(subscribers: Set<(value: T) => void>, value: T): void {
  for (const cb of subscribers) {
    try {
      cb(value);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  }
}

/**
 * A layer index, segment index or print time: any number but NaN (±Infinity is an open end). Checked
 * before anything is stored or queued, so a call made before the renderer is ready throws to its caller.
 */
function checkPosition(control: string, value: unknown): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new RangeError(`${control} needs a number that is not NaN (got ${String(value)})`);
  }
}

export function createPreviewController(options: PreviewControllerOptions = {}): PreviewController {
  let snapshot: GcodePreviewState = { ...INITIAL_STATE };
  const stateListeners = new Set<(s: GcodePreviewState) => void>();
  const mutate = (patch: Partial<GcodePreviewState>): void => {
    snapshot = { ...snapshot, ...patch };
    notifyAll(stateListeners, snapshot);
  };

  const session = new GcodeParseSession(options.createWorker === undefined ? {} : { worker: options.createWorker });
  // Non-reactive engine state: plain lets — snapshots carry summaries only.
  let renderer: PreviewRenderer | null = null;
  let unbindRendererEvents: (() => void) | null = null;
  let lastIR: ToolpathIR | null = null;
  let timeAxis: ToolpathTime | null = null;
  let lastMachine: MachineGeometry | undefined;
  let mapper: ProgressMapper | null = null;
  // The consumer's requested colour mode, kept so a `filament` request (colour by the file's own filament
  // colours) can be resolved against the parse metadata as each file loads (DD-024 flash fix).
  // Validated up front (a bad `range` / `only` throws a RangeError here), so no renderer ever gets it.
  if (options.renderer?.colorMode !== undefined) checkColorMode(options.renderer.colorMode);
  let requestedColorMode: ColorMode | undefined = options.renderer?.colorMode;
  let lastMetadata: DialectMetadata | undefined;
  let consumerVolumeSet = options.renderer?.buildVolume !== undefined;
  // The lens (DD-032): validated up front, and passed to every 3D renderer this controller binds, so a
  // canvas rebind or renderer reload keeps the last lens the consumer set.
  if (options.renderer?.cameraFov !== undefined) checkCameraFov(options.renderer.cameraFov);
  let cameraFov: number | undefined = options.renderer?.cameraFov;
  // The pixel ratio, kept the same way (validated up front, passed to every 3D renderer bound).
  if (options.renderer?.pixelRatio !== undefined) checkPixelRatio(options.renderer.pixelRatio);
  let pixelRatio: PixelRatioOption | undefined = options.renderer?.pixelRatio;
  let activeParse: Promise<unknown> | null = null;
  // Bumped by every parse() call: a call that is no longer the newest after an await was superseded (#529).
  let parseGen = 0;
  let resizeObserver: { disconnect(): void } | null = null;
  let windowResize: (() => void) | null = null;
  let disposed = false;
  // The 3D renderer is loaded on demand (DD-014: a 2D-only bundle never pulls Three.js), so binding
  // can resolve asynchronously. `bindGen` invalidates a slow load superseded by rebind/dispose;
  // `pendingOps` replays control calls made before the renderer is ready.
  let bindGen = 0;
  // Each queued call keeps its control name, so a call the renderer rejects on replay is reported by name.
  const pendingOps: Array<{ control: string; run: (r: PreviewRenderer) => void }> = [];
  const withRenderer = (control: string, fn: (r: PreviewRenderer) => void): void => {
    if (renderer !== null) fn(renderer);
    else pendingOps.push({ control, run: fn });
  };

  const listeners = new Set<(e: PreviewEvent) => void>();
  const emit = (e: PreviewEvent): void => notifyAll(listeners, e);

  function onRendererEvent(e: PreviewRendererEvent): void {
    if (e.type === 'buildComplete') {
      const decimated =
        e.decimationApplied > 1
          ? `Showing every ${ordinal(e.decimationApplied)} extrusion segment (layer boundaries kept); ` +
            `travel hidden. ${e.segments.toLocaleString()} segments drawn.`
          : '';
      // #518: segments a renderer skipped for an Infinity/NaN coordinate (2D: x/y; 3D: x/y/z), named by count.
      const skipped = e.skippedNonFinite ?? 0;
      const nonFinite =
        skipped > 0
          ? skipped === 1
            ? '1 segment with a non-finite coordinate was not drawn.'
            : `${skipped.toLocaleString()} segments with a non-finite coordinate were not drawn.`
          : '';
      mutate({
        activeQuality: e.quality,
        disclosure: decimated !== '' && nonFinite !== '' ? `${decimated} ${nonFinite}` : decimated + nonFinite
      });
    } else if (e.type === 'qualityFallback') {
      mutate({ activeQuality: e.to });
    } else if (e.type === 'progress-presentation-changed') {
      mutate({ presentation: e.mode });
    } else if (e.type === 'error') {
      mutate({ error: { code: e.code, message: e.message } });
    }
    emit(e);
  }

  function disposeRenderer(): void {
    unbindRendererEvents?.();
    unbindRendererEvents = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (windowResize !== null && typeof window !== 'undefined') {
      window.removeEventListener('resize', windowResize);
      windowResize = null;
    }
    renderer?.dispose();
    renderer = null;
  }

  function fitToCanvas(canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    renderer?.resize(w, h);
  }

  /** Wire a freshly-constructed renderer: events, sizing, replay of IR + queued control ops. */
  function applyRendererReady(canvas: HTMLCanvasElement, r: PreviewRenderer): void {
    renderer = r;
    unbindRendererEvents = r.onEvent(onRendererEvent);
    // Sizing (§4.2): explicit initial fit; ResizeObserver where available; window-resize
    // fallback because observers may never fire in embedded panes.
    fitToCanvas(canvas);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => fitToCanvas(canvas));
      ro.observe(canvas);
      resizeObserver = ro;
    }
    if (typeof window !== 'undefined') {
      windowResize = () => fitToCanvas(canvas);
      window.addEventListener('resize', windowResize);
    }
    if (lastIR !== null) {
      r.setIR(lastIR);
      // DD-005 consumer-wins: only auto-apply file geometry when the consumer set no volume.
      if (lastMachine !== undefined && !consumerVolumeSet) r.setBuildVolume(lastMachine);
    }
    // Replay control calls made during the (async) load, in order. The queue is taken first, so a rebind
    // never replays a call twice. A call the renderer rejects (e.g. a theme opacity outside [0, 1]) is
    // reported as E_CONTROL_REJECTED and the rest still apply: the renderer IS bound, so it is neither
    // a load failure nor a reason to drop later calls.
    for (const op of pendingOps.splice(0)) {
      try {
        op.run(r);
      } catch (err) {
        const message = `${op.control} rejected: ${err instanceof Error ? err.message : String(err)}`;
        mutate({ error: { code: 'E_CONTROL_REJECTED', message } });
        emit({ type: 'error', code: 'E_CONTROL_REJECTED', message });
      }
    }
    if (lastIR !== null) {
      mutate({ layerCount: r.layerCount, segmentCount: r.segmentCount });
      // The renderer bound after a parse already completed (on-demand 3D load) — refresh capability
      // state so a UI that mounted pre-render still gets accurate available-mode data (DD-031 G6).
      refreshCapabilityState();
    }
  }

  function bindCanvas(canvas: HTMLCanvasElement | null): void {
    if (disposed) return;
    disposeRenderer();
    if (canvas === null) return;
    const gen = ++bindGen;
    const r = options.renderer ?? {};
    if ((r.mode ?? '3d') === '2d') {
      // The 2D renderer is a static (three-free) import — construct synchronously.
      applyRendererReady(
        canvas,
        new LayerView2DRenderer(canvas, {
          colorMode: resolveColorMode(requestedColorMode, lastMetadata, lastIR),
          adjacentLayers: r.adjacentLayers,
          ghostOpacity: r.ghostOpacity
        })
      );
      return;
    }
    // 3D: load Three.js on demand so a 2D-only bundle never ships it (DD-014 D4).
    import('@chestnutlabs/gcode-renderer-three')
      .then((mod) => {
        if (disposed || gen !== bindGen) return; // superseded by a rebind/dispose during the load
        const r3d: PreviewRenderer = new mod.ToolpathRenderer({
          canvas,
          buildVolume: r.buildVolume,
          quality: r.quality ?? 'auto',
          qualityMode: r.qualityMode,
          progressivePreview: r.progressivePreview,
          cameraMode: r.cameraMode,
          cameraFov,
          ...(pixelRatio !== undefined ? { pixelRatio } : {}),
          frameContent: r.frameContent,
          interactionQuality: r.interactionQuality,
          colorMode: resolveColorMode(requestedColorMode, lastMetadata, lastIR),
          tube: r.tube,
          theme: r.theme,
          createRenderer: r.createRenderer,
          scheduleFrame: r.scheduleFrame,
          chunksPerTick: r.chunksPerTick,
          // DD-028: parallel tube build. Default to the batteries-included browser Web Worker in a
          // browser; Node/headless (no `Worker`) stays synchronous. A consumer can force `'off'`.
          geometryConcurrency: r.geometryConcurrency,
          geometryMemoryBudgetBytes: r.geometryMemoryBudgetBytes,
          ...(typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
            ? { coreBudget: navigator.hardwareConcurrency }
            : {}),
          ...(typeof Worker !== 'undefined' && r.geometryConcurrency !== 'off'
            ? { createGeometryWorker: mod.createBrowserGeometryWorker }
            : {})
        });
        applyRendererReady(canvas, r3d);
      })
      .catch((err: unknown) => {
        if (disposed || gen !== bindGen) return;
        const message = err instanceof Error ? err.message : String(err);
        mutate({ error: { code: 'E_RENDERER_LOAD', message } });
        emit({ type: 'error', code: 'E_RENDERER_LOAD', message });
      });
  }

  const offProgress = session.onProgress((p) => {
    mutate({ parseProgress: p });
    emit({ type: 'parse-progress', progress: p });
    // DD-029 staged progress: the parser's own phase maps to the preparation stage — `parsing` carries
    // the real byte fraction; `finalizing` (where dialect annotation settles) surfaces as `classifying`.
    // The renderer emits the later `building-geometry`/`preparing-gpu`/`ready` stages (forwarded below).
    const fraction = p.totalBytes > 0 ? p.bytesProcessed / p.totalBytes : undefined;
    emit({ type: 'stage', stage: p.phase === 'finalizing' ? 'classifying' : 'parsing', progress: fraction });
  });
  const offPartial = session.onPartial((slice) => {
    renderer?.appendPartial(slice);
  });

  async function parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome> {
    if (disposed) return { ok: false, error: { code: 'E_DISPOSED', message: 'preview disposed' } };
    const gen = ++parseGen;
    if (snapshot.parsing) {
      // §5: parse-during-parse cancels then restarts (session semantics preserved).
      session.cancel();
      await activeParse?.catch(() => undefined);
      // #529: several calls can wait on the same running parse (a; b; c in one tick). Only the newest may
      // start; an older one was superseded before it began, so it reports cancelled (no event: it never ran).
      if (gen !== parseGen || disposed) return { ok: false, cancelled: true };
    }
    mutate({ parsing: true, parseProgress: null, error: null });
    const bytes =
      typeof File !== 'undefined' && input instanceof File
        ? input.size
        : (input as Uint8Array | ArrayBuffer).byteLength;
    emit({ type: 'parse-started', bytes });
    const wire = { ...options.parseDefaults, ...opts };
    const run = session.parse(input instanceof ArrayBuffer ? toBytes(input) : input, wire);
    activeParse = run;
    try {
      const result = await run;
      // #529: a newer parse() was issued while this one ran (its cancel can lose the race to completion).
      // Its result is for a file the caller has replaced: never apply it.
      if (gen !== parseGen) throw new CancelledError('superseded by a newer parse');
      lastIR = result.ir;
      lastMetadata = result.metadata;
      lastMachine = result.metadata?.machine;
      mapper = createProgressMapper(result.ir, { fileSizeBytes: bytes });
      // Time axis (#181): prefer the slicer's own estimate (#183) for the total; the kinematic axis
      // always backs time-scrub. `hasUnknownFeedrate` means the kinematic total is a lower bound.
      timeAxis = computeToolpathTime(result.ir);
      const slicerSeconds = result.metadata?.printEstimate?.seconds;
      const totalTimeMs = slicerSeconds !== undefined ? slicerSeconds * 1000 : timeAxis.totalMs;
      const timeEstimateSource: 'slicer' | 'kinematic' = slicerSeconds !== undefined ? 'slicer' : 'kinematic';
      const counts =
        renderer !== null
          ? { layerCount: renderer.layerCount, segmentCount: renderer.segmentCount }
          : { layerCount: result.ir.layers.length, segmentCount: result.ir.segments.count };
      if (renderer !== null) {
        // Resolve a `filament` colour request against THIS file's metadata BEFORE the build, so the first
        // visible pass is already coloured from the source's own filament colours — no neutral-then-recolor
        // flash (DD-024). A pass-through mode is unchanged.
        if (requestedColorMode?.mode === 'filament') {
          renderer.setColorMode(resolveColorMode(requestedColorMode, result.metadata, result.ir) as ColorMode);
        }
        renderer.setIR(result.ir);
      }
      mutate({
        summary: {
          segments: result.ir.segments.count,
          layers: result.ir.layers.length,
          complete: result.ir.header.complete,
          stopReason: result.stats.stopReason?.code,
          capabilities: { ...result.ir.header.capabilities },
          warnings: result.ir.header.warnings.length
        },
        metadata: result.metadata,
        presentation: 'hidden',
        totalTimeMs,
        timeEstimateSource,
        ...(renderer !== null ? { layerCount: renderer.layerCount, segmentCount: renderer.segmentCount } : counts)
      });
      // DD-005 consumer-wins precedence: a consumer-configured volume blocks auto-apply.
      if (lastMachine !== undefined) {
        if (consumerVolumeSet) emit({ type: 'machine-geometry-discovered', machine: lastMachine });
        else renderer?.setBuildVolume(lastMachine);
      }
      emit({
        type: 'parse-complete',
        segments: result.ir.segments.count,
        layers: result.ir.layers.length,
        complete: result.ir.header.complete,
        capabilities: { ...result.ir.header.capabilities },
        warnings: result.ir.header.warnings,
        metadata: result.metadata
      });
      // DD-031 G6: populate the capability-aware state (available color modes, retraction/color-change
      // presence) now the renderer holds this file's IR. No-op if the (async 3D) renderer isn't ready
      // yet — applyRendererReady refreshes it when the renderer binds.
      refreshCapabilityState();
      return { ok: true, result };
    } catch (err) {
      // #529: a superseded run is cancelled whatever way it settled (a worker error or crash that beat the
      // cancel included): its failure belongs to a file the caller already replaced.
      if (err instanceof CancelledError || gen !== parseGen) {
        emit({ type: 'parse-cancelled' });
        return { ok: false, cancelled: true };
      }
      const code = err instanceof ParseSessionError ? err.code : 'E_UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);
      mutate({ error: { code, message } });
      emit({ type: 'parse-error', code, message });
      return { ok: false, error: { code, message } };
    } finally {
      mutate({ parsing: false, parseProgress: null });
      if (activeParse === run) activeParse = null;
    }
  }

  // DD-031 G6: refresh the capability-aware state a consumer UI reads to offer/explain controls
  // (available color modes, retraction/color-change presence). Derived from the renderer, which owns
  // the honest IR capability gates. No-op until the renderer is bound and has the IR.
  function refreshCapabilityState(): void {
    if (renderer === null) return;
    const r = renderer;
    mutate({
      availableColorModes: ALL_COLOR_MODES.filter((m) => r.isColorModeAvailable(m)),
      hasRetractions: r.hasRetractions,
      hasColorChanges: r.hasColorChanges
    });
  }

  const controls: GcodePreviewControls = {
    // Controls queue when the (async) renderer isn't ready yet, then replay in order on bind.
    setLayerRange: (a, b) => {
      checkPosition('setLayerRange startLayer', a);
      checkPosition('setLayerRange endLayer', b);
      withRenderer('setLayerRange', (r) => r.setLayerRange(a, b));
    },
    setScrubPosition: (s) => {
      if (s !== null) checkPosition('setScrubPosition', s);
      withRenderer('setScrubPosition', (r) => r.setScrubPosition(s));
    },
    setScrubTime: (ms) => {
      if (ms === null) {
        withRenderer('setScrubTime', (r) => r.setScrubPosition(null));
        return;
      }
      checkPosition('setScrubTime', ms);
      // Before a successful parse there is no time axis: a documented no-op (it must not clear a scrub cut).
      if (timeAxis === null) return;
      // Resolve a print time to a segment-index scrub cut via the kinematic axis (#181). `completed` segments
      // are done, and the renderer's scrub index is INCLUSIVE (draws indices <= it), so the cut is completed - 1
      // (-1 draws nothing: no segment has finished at that time).
      const cut = segmentsCompletedAtTime(timeAxis.cumulativeMs, ms) - 1;
      withRenderer('setScrubTime', (r) => r.setScrubPosition(cut));
    },
    setKindVisible: (k, v) => withRenderer('setKindVisible', (r) => r.setKindVisible(k, v)),
    setFeatureRoleVisible: (role, v) =>
      withRenderer('setFeatureRoleVisible', (r) => r.setFeatureRoleVisible?.(role, v)),
    setShowRetractions: (v) => withRenderer('setShowRetractions', (r) => r.setShowRetractions(v)),
    // Availability is IR/renderer-dependent; before the renderer is ready we optimistically queue
    // and report true (the mode applies once bound). Callers can re-check after `parse-complete`.
    setColorMode: (m) => {
      // Synchronous, before anything is stored or queued: a bad mode throws here, the previous mode stays
      // in effect, and nothing reaches a renderer bound later.
      checkColorMode(m);
      // Remember the request so a `filament` mode re-resolves per file; resolve it against the current
      // metadata before handing the concrete mode to the renderer (DD-024).
      requestedColorMode = m;
      const resolved = (resolveColorMode(m, lastMetadata, lastIR) ?? m) as ColorMode;
      if (renderer !== null) return renderer.setColorMode(resolved);
      pendingOps.push({ control: 'setColorMode', run: (r) => r.setColorMode(resolved) });
      return true;
    },
    setQuality: (q) => withRenderer('setQuality', (r) => r.setQuality(q)),
    setQualityMode: (m) => withRenderer('setQualityMode', (r) => r.setQualityMode(m)),
    setProgressivePreview: (m) => withRenderer('setProgressivePreview', (r) => r.setProgressivePreview(m)),
    setCameraMode: (m) => withRenderer('setCameraMode', (r) => r.setCameraMode(m)),
    setCameraFov: (fov) => {
      // Synchronous, so a call made before the on-demand 3D load throws here, not later in the replay.
      checkCameraFov(fov);
      cameraFov = fov;
      withRenderer('setCameraFov', (r) => r.setCameraFov?.(fov));
    },
    setPixelRatio: (ratio) => {
      checkPixelRatio(ratio);
      pixelRatio = ratio;
      withRenderer('setPixelRatio', (r) => r.setPixelRatio?.(ratio));
    },
    setView: (v) => withRenderer('setView', (r) => r.setView(v)),
    // Returns a value, so it can't queue: before the renderer is ready (or on 2D) there is no pose → null.
    getCameraState: () => (renderer !== null ? renderer.getCameraState() : null),
    capture: (opts) =>
      renderer !== null && typeof renderer.capture === 'function'
        ? renderer.capture(opts)
        : Promise.reject(new CaptureUnsupportedError('capture unavailable: renderer not ready or unsupported')),
    // Value-returning queries can't queue: before the renderer is ready they answer honestly
    // (null diagnostics/pick; optimistic color-mode availability, re-checkable after parse-complete).
    getRenderStats: () => (renderer !== null ? renderer.getRenderStats() : null),
    pickSegment: (ndcX, ndcY, threshold) => (renderer !== null ? renderer.pickSegment(ndcX, ndcY, threshold) : null),
    isColorModeAvailable: (mode) => (renderer !== null ? renderer.isColorModeAvailable(mode) : true),
    setCameraState: (s) => withRenderer('setCameraState', (r) => r.setCameraState(s)),
    setTheme: (t) => withRenderer('setTheme', (r) => r.setTheme(t)),
    setBuildVolume: (def) => {
      consumerVolumeSet = true;
      withRenderer('setBuildVolume', (r) => r.setBuildVolume(def));
    },
    setBuildVolumeCage: (v) => withRenderer('setBuildVolumeCage', (r) => r.setBuildVolumeCage(v)),
    setFrameContent: (m) => withRenderer('setFrameContent', (r) => r.setFrameContent(m)),
    setInteractionQuality: (m) => withRenderer('setInteractionQuality', (r) => r.setInteractionQuality(m)),
    frame: () => withRenderer('frame', (r) => r.frame())
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    session.cancel();
    offProgress();
    offPartial();
    session.dispose();
    // No queue clear: once disposed, nothing replays it (bindCanvas and an in-flight 3D load both return).
    disposeRenderer();
    lastIR = null;
    timeAxis = null;
    mapper = null;
    listeners.clear();
    stateListeners.clear();
  }

  return {
    bindCanvas,
    parse,
    cancel: () => session.cancel(),
    observeProgress: (obs) => {
      if (mapper === null) return null;
      const mapped = mapper.observe(obs);
      renderer?.setProgress(mapped);
      return mapped;
    },
    tickProgress: (nowMs) => {
      if (mapper === null) return null;
      const mapped = mapper.tick(nowMs);
      renderer?.setProgress(mapped);
      return mapped;
    },
    clearProgress: () => {
      mapper?.reset();
      renderer?.setProgress(null);
      mutate({ presentation: 'hidden' });
    },
    getState: () => snapshot,
    onStateChange: (cb) => {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    controls,
    raw: { session, renderer: () => renderer },
    onEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose
  };
}
