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
  ColorMode,
  GLRendererLike,
  ProgressPresentationMode,
  QualityMode,
  RenderTargetCanvas,
  Theme,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import { LayerView2DRenderer } from './renderer-2d-adapter.js';
import type { MoveKindToggle, PreviewRenderer, PreviewRendererEvent, RendererMode } from './renderer-interface.js';
import {
  createProgressMapper,
  computeToolpathTime,
  segmentsCompletedAtTime,
  type Confidence,
  type DialectMetadata,
  type MachineGeometry,
  type MappedProgress,
  type ProgressMapper,
  type ProgressObservation,
  type ToolpathIR,
  type ToolpathTime,
  type Warning
} from '@chestnutlabs/toolpath-core';

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
    /** Camera projection (#150, DD-009 D3); default 'perspective'. 3D only. */
    cameraMode?: CameraMode;
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
  /** User-presentable decimation/travel disclosure (empty when rendering everything). */
  disclosure: string;
  /**
   * Estimated total print time in ms (#181), or null before a parse. `timeEstimateSource` says whether
   * it's the slicer's own estimate (`'slicer'`, trustworthy) or a kinematic approximation
   * (`'kinematic'`, constant-velocity, slightly low — disclose when shown).
   */
  totalTimeMs: number | null;
  timeEstimateSource: 'slicer' | 'kinematic' | null;
  error: { code: string; message: string } | null;
}

export interface GcodePreviewControls {
  setLayerRange(startLayer: number, endLayer: number): void;
  setScrubPosition(segIndex: number | null): void;
  /**
   * Time-based scrub (#181): cut the toolpath at print time `ms` (kinematic axis). null clears the
   * cut. Resolves to a segment-index scrub; no-op before a successful parse.
   */
  setScrubTime(ms: number | null): void;
  setKindVisible(kind: MoveKindToggle, visible: boolean): void;
  /** Opt-in retraction/deretraction markers (DD-009 D1, #148). Off by default. */
  setShowRetractions(visible: boolean): void;
  setColorMode(mode: ColorMode): boolean;
  setQuality(quality: QualityMode | 'auto'): void;
  /** Switch camera projection (#150, DD-009 D3). */
  setCameraMode(mode: CameraMode): void;
  /** Snap to a preset orientation — top/front/iso/… (#268). Instant; preserves the projection.
   *  The 2D renderer discloses this via `renderer-unsupported` rather than moving. */
  setView(view: CameraView): void;
  /** Read the current camera as a serializable snapshot (#268), or null before the renderer is ready
   *  / on the 2D renderer (which has no 3D pose). */
  getCameraState(): CameraState | null;
  /** Restore a camera snapshot verbatim (#268) — no re-fit to the current model. 2D discloses. */
  setCameraState(state: CameraState): void;
  /** Apply a bounded declarative theme (#153, DD-009 D4). */
  setTheme(theme: Theme): void;
  /** Marks the volume consumer-configured: file-discovered geometry stops auto-applying. */
  setBuildVolume(def: BuildVolumeDef | MachineGeometry): void;
  /** Show/hide the build-volume wireframe cage independently of the bed/plate (#306/#6). */
  setBuildVolumeCage(visible: boolean): void;
  /** Frame the printed 'object' (excl. skirt/prime) vs 'all' extrusion, and re-frame (#306/#6). */
  setFrameContent(mode: 'object' | 'all'): void;
  /** Interaction-aware quality: 'auto' reduces detail while the camera moves (#306/2, DD-020). */
  setInteractionQuality(mode: 'off' | 'auto'): void;
  frame(): void;
}

export interface PreviewController {
  /** Bind/rebind the renderer to a canvas (null unbinds). Rebinding disposes safely. */
  bindCanvas(canvas: HTMLCanvasElement | null): void;
  parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome>;
  cancel(): void;
  /** DD-006: map one observation and drive the overlay. Null before a successful parse. */
  observeProgress(obs: ProgressObservation): MappedProgress | null;
  /** Recompute staleness (DD-006 §4.4.3) — call at ~1 Hz while telemetry may go quiet. */
  tickProgress(nowMs: number): MappedProgress | null;
  clearProgress(): void;
  /** Current immutable state snapshot (identity changes on every state change). */
  getState(): GcodePreviewState;
  /** Subscribe to snapshot replacements. Returns the unsubscriber. */
  onStateChange(cb: (state: GcodePreviewState) => void): () => void;
  controls: GcodePreviewControls;
  /**
   * Escape hatches — the neutral objects themselves (advanced use). `renderer()` returns the active
   * {@link PreviewRenderer} (the 3D `ToolpathRenderer` or the 2D `LayerView2DRenderer`), or null
   * before bind / during the 3D renderer's on-demand load.
   */
  raw: { session: GcodeParseSession; renderer: () => PreviewRenderer | null };
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
  error: null
};

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function createPreviewController(options: PreviewControllerOptions = {}): PreviewController {
  let snapshot: GcodePreviewState = { ...INITIAL_STATE };
  const stateListeners = new Set<(s: GcodePreviewState) => void>();
  const mutate = (patch: Partial<GcodePreviewState>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const cb of stateListeners) cb(snapshot);
  };

  const session = new GcodeParseSession(options.createWorker === undefined ? {} : { worker: options.createWorker });
  // Non-reactive engine state: plain lets — snapshots carry summaries only.
  let renderer: PreviewRenderer | null = null;
  let unbindRendererEvents: (() => void) | null = null;
  let lastIR: ToolpathIR | null = null;
  let timeAxis: ToolpathTime | null = null;
  let lastMachine: MachineGeometry | undefined;
  let mapper: ProgressMapper | null = null;
  let consumerVolumeSet = options.renderer?.buildVolume !== undefined;
  let activeParse: Promise<unknown> | null = null;
  let resizeObserver: { disconnect(): void } | null = null;
  let windowResize: (() => void) | null = null;
  let disposed = false;
  // The 3D renderer is loaded on demand (DD-014: a 2D-only bundle never pulls Three.js), so binding
  // can resolve asynchronously. `bindGen` invalidates a slow load superseded by rebind/dispose;
  // `pendingOps` replays control calls made before the renderer is ready.
  let bindGen = 0;
  const pendingOps: Array<(r: PreviewRenderer) => void> = [];
  const withRenderer = (fn: (r: PreviewRenderer) => void): void => {
    if (renderer !== null) fn(renderer);
    else pendingOps.push(fn);
  };

  const listeners = new Set<(e: PreviewEvent) => void>();
  const emit = (e: PreviewEvent): void => {
    for (const cb of listeners) cb(e);
  };

  function onRendererEvent(e: PreviewRendererEvent): void {
    if (e.type === 'buildComplete') {
      mutate({
        activeQuality: e.quality,
        disclosure:
          e.decimationApplied > 1
            ? `Showing every ${e.decimationApplied}th extrusion segment (layer boundaries kept); ` +
              `travel hidden. ${e.segments.toLocaleString()} segments drawn.`
            : ''
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
    // Replay control calls made during the (async) load, in order.
    for (const op of pendingOps) op(r);
    pendingOps.length = 0;
    if (lastIR !== null) mutate({ layerCount: r.layerCount, segmentCount: r.segmentCount });
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
          colorMode: r.colorMode,
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
          cameraMode: r.cameraMode,
          frameContent: r.frameContent,
          interactionQuality: r.interactionQuality,
          colorMode: r.colorMode,
          tube: r.tube,
          theme: r.theme,
          createRenderer: r.createRenderer,
          scheduleFrame: r.scheduleFrame,
          chunksPerTick: r.chunksPerTick
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
  });
  const offPartial = session.onPartial((slice) => {
    renderer?.appendPartial(slice);
  });

  async function parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome> {
    if (disposed) return { ok: false, error: { code: 'E_DISPOSED', message: 'preview disposed' } };
    if (snapshot.parsing) {
      // §5: parse-during-parse cancels then restarts (session semantics preserved).
      session.cancel();
      await activeParse?.catch(() => undefined);
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
      lastIR = result.ir;
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
      if (renderer !== null) renderer.setIR(result.ir);
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
      return { ok: true, result };
    } catch (err) {
      if (err instanceof CancelledError) {
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

  const controls: GcodePreviewControls = {
    // Controls queue when the (async) renderer isn't ready yet, then replay in order on bind.
    setLayerRange: (a, b) => withRenderer((r) => r.setLayerRange(a, b)),
    setScrubPosition: (s) => withRenderer((r) => r.setScrubPosition(s)),
    setScrubTime: (ms) => {
      // Resolve a print time to a segment-index scrub cut via the kinematic axis (#181).
      const seg = ms === null || timeAxis === null ? null : segmentsCompletedAtTime(timeAxis.cumulativeMs, ms);
      withRenderer((r) => r.setScrubPosition(seg));
    },
    setKindVisible: (k, v) => withRenderer((r) => r.setKindVisible(k, v)),
    setShowRetractions: (v) => withRenderer((r) => r.setShowRetractions(v)),
    // Availability is IR/renderer-dependent; before the renderer is ready we optimistically queue
    // and report true (the mode applies once bound). Callers can re-check after `parse-complete`.
    setColorMode: (m) => {
      if (renderer !== null) return renderer.setColorMode(m);
      pendingOps.push((r) => r.setColorMode(m));
      return true;
    },
    setQuality: (q) => withRenderer((r) => r.setQuality(q)),
    setCameraMode: (m) => withRenderer((r) => r.setCameraMode(m)),
    setView: (v) => withRenderer((r) => r.setView(v)),
    // Returns a value, so it can't queue: before the renderer is ready (or on 2D) there is no pose → null.
    getCameraState: () => (renderer !== null ? renderer.getCameraState() : null),
    setCameraState: (s) => withRenderer((r) => r.setCameraState(s)),
    setTheme: (t) => withRenderer((r) => r.setTheme(t)),
    setBuildVolume: (def) => {
      consumerVolumeSet = true;
      withRenderer((r) => r.setBuildVolume(def));
    },
    setBuildVolumeCage: (v) => withRenderer((r) => r.setBuildVolumeCage(v)),
    setFrameContent: (m) => withRenderer((r) => r.setFrameContent(m)),
    setInteractionQuality: (m) => withRenderer((r) => r.setInteractionQuality(m)),
    frame: () => withRenderer((r) => r.frame())
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    session.cancel();
    offProgress();
    offPartial();
    session.dispose();
    disposeRenderer();
    pendingOps.length = 0;
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
