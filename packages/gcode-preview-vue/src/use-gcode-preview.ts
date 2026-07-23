/**
 * useGcodePreview — the headless Vue composable over the framework-neutral triple
 * (DD-007 §4.1–4.2, phase 1, issue #104): GcodeParseSession (worker parse) +
 * ToolpathRenderer (scene) + createProgressMapper (DD-006 live progress).
 *
 * This layer owns exactly the Vue-glue mechanics and adds zero features below the
 * seam: canvas binding via a template ref, dispose-on-scope-teardown (unmount/HMR),
 * SSR-import safety (no browser globals at module scope), ResizeObserver sizing with
 * the initial-fit + window-resize fallback the demo learned the hard way, and a strict
 * reactivity boundary — IR/typed arrays are NEVER made reactive (§4.2).
 */
import { getCurrentScope, onScopeDispose, readonly, ref, shallowReactive, watch, type Ref } from 'vue';
import {
  GcodeParseSession,
  CancelledError,
  ParseSessionError,
  type ParseProgress,
  type ParseResult,
  type SessionOptions,
  type WireParseOptions
} from '@chestnutlabs/gcode-parser';
import {
  ToolpathRenderer,
  type BuildVolumeDef,
  type ColorMode,
  type GLRendererLike,
  type ProgressPresentationMode,
  type QualityMode,
  type RendererEvent,
  type TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import {
  createProgressMapper,
  type Confidence,
  type DialectMetadata,
  type MachineGeometry,
  type MappedProgress,
  type ProgressMapper,
  type ProgressObservation,
  type ToolpathIR
} from '@chestnutlabs/toolpath-core';

/** Session/renderer events, re-emitted, plus the composable's own lifecycle events. */
export type PreviewEvent =
  | RendererEvent
  | { type: 'parse-started'; bytes: number }
  | { type: 'parse-progress'; progress: ParseProgress }
  | { type: 'parse-complete'; segments: number; layers: number; complete: boolean }
  | { type: 'parse-cancelled' }
  | { type: 'parse-error'; code: string; message: string }
  | {
      /** File-discovered geometry NOT auto-applied because the consumer configured a
       *  volume (DD-005 consumer-wins precedence) — the host decides. */
      type: 'machine-geometry-discovered';
      machine: MachineGeometry;
    };

export interface UseGcodePreviewOptions {
  /** Custom worker factory (DD-005 slim/custom entries). Default: the batteries worker. */
  createWorker?: SessionOptions['worker'];
  renderer?: {
    buildVolume?: BuildVolumeDef;
    quality?: QualityMode | 'auto';
    colorMode?: ColorMode;
    tube?: TubeOptions;
    /** Advanced/test injectables — pass-throughs of the renderer's own contract. */
    createRenderer?: (canvas: HTMLCanvasElement) => GLRendererLike;
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
  error: { code: string; message: string } | null;
}

export interface GcodePreviewControls {
  setLayerRange(startLayer: number, endLayer: number): void;
  setScrubPosition(segIndex: number | null): void;
  setKindVisible(kind: 'extrude' | 'travel', visible: boolean): void;
  setColorMode(mode: ColorMode): boolean;
  setQuality(quality: QualityMode | 'auto'): void;
  /** Marks the volume consumer-configured: file-discovered geometry stops auto-applying. */
  setBuildVolume(def: BuildVolumeDef | MachineGeometry): void;
  frame(): void;
}

export interface GcodePreviewHandle {
  /** Bind to a <canvas> template ref; rebinding disposes and rebuilds safely. */
  canvasRef: Ref<HTMLCanvasElement | null>;
  parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome>;
  cancel(): void;
  /** DD-006: map one observation and drive the overlay. Null before a successful parse. */
  observeProgress(obs: ProgressObservation): MappedProgress | null;
  /** Recompute staleness (DD-006 §4.4.3) — call at ~1 Hz while telemetry may go quiet. */
  tickProgress(nowMs: number): MappedProgress | null;
  clearProgress(): void;
  state: Readonly<GcodePreviewState>;
  controls: GcodePreviewControls;
  /** Escape hatches — the neutral objects themselves (advanced use; not reactive). */
  raw: { session: GcodeParseSession; renderer: () => ToolpathRenderer | null };
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  dispose(): void;
}

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function useGcodePreview(options: UseGcodePreviewOptions = {}): GcodePreviewHandle {
  const canvasRef = ref<HTMLCanvasElement | null>(null);
  const state = shallowReactive<GcodePreviewState>({
    parsing: false,
    parseProgress: null,
    summary: null,
    metadata: undefined,
    activeQuality: null,
    presentation: 'hidden',
    layerCount: 0,
    segmentCount: 0,
    disclosure: '',
    error: null
  });

  const session = new GcodeParseSession(options.createWorker === undefined ? {} : { worker: options.createWorker });
  // Non-reactive engine state (§4.2 reactivity boundary): plain lets, never refs.
  let renderer: ToolpathRenderer | null = null;
  let unbindRendererEvents: (() => void) | null = null;
  let lastIR: ToolpathIR | null = null;
  let lastMachine: MachineGeometry | undefined;
  let mapper: ProgressMapper | null = null;
  let consumerVolumeSet = options.renderer?.buildVolume !== undefined;
  let activeParse: Promise<unknown> | null = null;
  let resizeObserver: { disconnect(): void } | null = null;
  let windowResize: (() => void) | null = null;
  let disposed = false;

  const listeners = new Set<(e: PreviewEvent) => void>();
  const emit = (e: PreviewEvent): void => {
    for (const cb of listeners) cb(e);
  };

  function onRendererEvent(e: RendererEvent): void {
    if (e.type === 'buildComplete') {
      state.activeQuality = e.quality;
      state.disclosure =
        e.decimationApplied > 1
          ? `Showing every ${e.decimationApplied}th extrusion segment (layer boundaries kept); ` +
            `travel hidden. ${e.segments.toLocaleString()} segments drawn.`
          : '';
    } else if (e.type === 'qualityFallback') {
      state.activeQuality = e.to;
    } else if (e.type === 'progress-presentation-changed') {
      state.presentation = e.mode;
    } else if (e.type === 'error') {
      state.error = { code: e.code, message: e.message };
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

  function bindCanvas(canvas: HTMLCanvasElement): void {
    disposeRenderer();
    const r = options.renderer ?? {};
    renderer = new ToolpathRenderer({
      canvas,
      buildVolume: r.buildVolume,
      quality: r.quality ?? 'auto',
      colorMode: r.colorMode,
      tube: r.tube,
      createRenderer: r.createRenderer,
      scheduleFrame: r.scheduleFrame,
      chunksPerTick: r.chunksPerTick
    });
    unbindRendererEvents = renderer.onEvent(onRendererEvent);
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
      renderer.setIR(lastIR);
      state.layerCount = renderer.layerCount;
      state.segmentCount = renderer.segmentCount;
    }
  }

  watch(canvasRef, (canvas) => {
    if (disposed) return;
    if (canvas === null) disposeRenderer();
    else bindCanvas(canvas);
  });

  const offProgress = session.onProgress((p) => {
    state.parseProgress = p;
    emit({ type: 'parse-progress', progress: p });
  });
  const offPartial = session.onPartial((slice) => {
    renderer?.appendPartial(slice);
  });

  async function parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome> {
    if (disposed) return { ok: false, error: { code: 'E_DISPOSED', message: 'preview disposed' } };
    if (state.parsing) {
      // §5: parse-during-parse cancels then restarts (session semantics preserved).
      session.cancel();
      await activeParse?.catch(() => undefined);
    }
    state.parsing = true;
    state.parseProgress = null;
    state.error = null;
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
      state.summary = {
        segments: result.ir.segments.count,
        layers: result.ir.layers.length,
        complete: result.ir.header.complete,
        stopReason: result.stats.stopReason?.code,
        capabilities: { ...result.ir.header.capabilities },
        warnings: result.ir.header.warnings.length
      };
      state.metadata = result.metadata;
      if (renderer !== null) {
        renderer.setIR(result.ir);
        state.layerCount = renderer.layerCount;
        state.segmentCount = renderer.segmentCount;
      } else {
        state.layerCount = result.ir.layers.length;
        state.segmentCount = result.ir.segments.count;
      }
      state.presentation = 'hidden';
      // DD-005 consumer-wins precedence: a consumer-configured volume blocks auto-apply.
      if (lastMachine !== undefined) {
        if (consumerVolumeSet) emit({ type: 'machine-geometry-discovered', machine: lastMachine });
        else renderer?.setBuildVolume(lastMachine);
      }
      emit({
        type: 'parse-complete',
        segments: result.ir.segments.count,
        layers: result.ir.layers.length,
        complete: result.ir.header.complete
      });
      return { ok: true, result };
    } catch (err) {
      if (err instanceof CancelledError) {
        emit({ type: 'parse-cancelled' });
        return { ok: false, cancelled: true };
      }
      const code = err instanceof ParseSessionError ? err.code : 'E_UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);
      state.error = { code, message };
      emit({ type: 'parse-error', code, message });
      return { ok: false, error: { code, message } };
    } finally {
      state.parsing = false;
      state.parseProgress = null;
      if (activeParse === run) activeParse = null;
    }
  }

  const controls: GcodePreviewControls = {
    setLayerRange: (a, b) => renderer?.setLayerRange(a, b),
    setScrubPosition: (s) => renderer?.setScrubPosition(s),
    setKindVisible: (k, v) => renderer?.setKindVisible(k, v),
    setColorMode: (m) => renderer?.setColorMode(m) ?? false,
    setQuality: (q) => renderer?.setQuality(q),
    setBuildVolume: (def) => {
      consumerVolumeSet = true;
      renderer?.setBuildVolume(def);
    },
    frame: () => renderer?.frame()
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    session.cancel();
    offProgress();
    offPartial();
    session.dispose();
    disposeRenderer();
    lastIR = null;
    mapper = null;
    listeners.clear();
  }

  // Unmount/HMR safety (§4.2): auto-dispose with the owning effect scope, when there is one.
  if (getCurrentScope() !== undefined) onScopeDispose(dispose);

  return {
    canvasRef,
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
      state.presentation = 'hidden';
    },
    state: readonly(state) as Readonly<GcodePreviewState>,
    controls,
    raw: { session, renderer: () => renderer },
    onEvent: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose
  };
}
