/**
 * <GcodePreview> — the ready-to-use component (DD-007 §4.1 D1/D4, phase 2, issue #105).
 *
 * Strictly a SHELL over `useGcodePreview` (D1: never a separate implementation): every prop
 * maps to a composable call, every emit re-fires a composable event, and the underlying handle
 * is exposed for template-ref access. Advanced props are optional with sensible defaults, so
 * `<GcodePreview :source="file" />` alone is a working viewer (D4).
 *
 * Render-function component on purpose (no SFC): the template is a single full-size <canvas>,
 * and staying pure TypeScript keeps the package on the plain tsc build with typed props/emits.
 */
import { defineComponent, h, onMounted, ref, watch, type PropType } from 'vue';
import type {
  BuildVolumeDef,
  CameraMode,
  CameraState,
  CameraView,
  ColorMode,
  QualityMode,
  Theme,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import type { Confidence, Warning } from '@chestnutlabs/toolpath-core';
import type { MachineGeometry, ProgressObservation } from '@chestnutlabs/toolpath-core';
import type { WireParseOptions, WorkerLike } from '@chestnutlabs/gcode-parser';
import {
  useGcodePreview,
  type PreviewEvent,
  type RendererMode,
  type UseGcodePreviewOptions
} from './use-gcode-preview.js';

export type GcodePreviewSource = Uint8Array | ArrayBuffer | File | null;

export const GcodePreview = defineComponent({
  name: 'GcodePreview',
  props: {
    /** The one required-in-practice prop: bytes/File to parse. Changing it re-parses. */
    source: { type: [Object, Uint8Array, ArrayBuffer, File] as PropType<GcodePreviewSource>, default: null },
    parseOptions: { type: Object as PropType<WireParseOptions>, default: undefined },
    /** DD-014 D5: `'3d'` (default, Three.js — loaded on demand) or `'2d'` (low-resource Canvas view). */
    renderer: { type: String as PropType<RendererMode>, default: undefined },
    /** 2D only (`renderer="2d"`): preceding "ghost" layers beneath the active one (default 1, floor 0). */
    adjacentLayers: { type: Number as PropType<number>, default: undefined },
    /** Consumer-configured volume — wins over file-discovered geometry (DD-005 precedence). */
    buildVolume: { type: Object as PropType<BuildVolumeDef | MachineGeometry>, default: undefined },
    quality: { type: String as PropType<QualityMode | 'auto'>, default: 'auto' },
    /** #150 (DD-009 D3): camera projection. */
    cameraMode: { type: String as PropType<CameraMode>, default: 'perspective' },
    /** #268/#275/M6: snap to a preset orientation (top/front/iso/…). */
    view: { type: String as PropType<CameraView>, default: undefined },
    /** #268/#275/M6: restore a saved camera pose. Pair with `@camera-change` for a two-way binding. */
    cameraState: { type: Object as PropType<CameraState | null>, default: undefined },
    /** #153 (DD-009 D4): bounded declarative theme. */
    theme: { type: Object as PropType<Theme>, default: undefined },
    colorMode: { type: Object as PropType<ColorMode>, default: undefined },
    tube: { type: Object as PropType<TubeOptions>, default: undefined },
    /** Inclusive [start, end]; null shows every layer. */
    layerRange: { type: Array as unknown as PropType<[number, number] | null>, default: null },
    /** Scrub cut (IR segment index); null shows everything up to the layer range. */
    scrub: { type: Number as PropType<number | null>, default: null },
    /** Time-based scrub cut in ms of print time (#181); null clears it. */
    scrubTime: { type: Number as PropType<number | null>, default: null },
    showTravel: { type: Boolean, default: true },
    /** DD-016 (#182): show slicer wipe moves. Default true. */
    showWipe: { type: Boolean, default: true },
    /** DD-009 D1 (#148): opt-in retraction/deretraction markers. */
    showRetractions: { type: Boolean, default: false },
    /** DD-006 live progress observation; null hides the overlay. */
    progress: { type: Object as PropType<ProgressObservation | null>, default: null },
    /** Worker factory escape hatch (DD-005 slim/custom entries; D2). Factory form only —
     *  a worker INSTANCE cannot survive re-parse lifecycles the way a factory can. */
    createWorker: {
      type: Function as PropType<() => WorkerLike>,
      default: undefined
    },
    /** Advanced/test renderer injectables (pass-throughs of the renderer contract). */
    rendererOptions: {
      type: Object as PropType<
        Omit<
          NonNullable<UseGcodePreviewOptions['renderer']>,
          'buildVolume' | 'quality' | 'cameraMode' | 'theme' | 'colorMode' | 'tube'
        >
      >,
      default: undefined
    }
  },
  emits: {
    /* eslint-disable @typescript-eslint/no-unused-vars -- emit validators document payloads */
    ready: (_summary: {
      segments: number;
      layers: number;
      complete: boolean;
      capabilities: Record<string, Confidence>;
      warnings: readonly Warning[];
    }) => true,
    'camera-change': (_state: CameraState) => true,
    'parse-error': (_e: { code: string; message: string }) => true,
    'parse-cancelled': () => true,
    'parse-progress': (_p: { bytesProcessed: number; totalBytes: number }) => true,
    'build-complete': (_e: { segments: number; quality: QualityMode }) => true,
    'quality-fallback': (_e: { from: QualityMode; to: QualityMode; reason: string }) => true,
    'machine-geometry-mismatch': (_message: string) => true,
    'machine-geometry-discovered': (_machine: MachineGeometry) => true,
    'progress-presentation-changed': (_e: { mode: string; reason?: string }) => true,
    disclosure: (_text: string) => true,
    error: (_e: { code: string; message: string }) => true
    /* eslint-enable @typescript-eslint/no-unused-vars */
  },
  setup(props, { emit, expose }) {
    const preview = useGcodePreview({
      createWorker: props.createWorker,
      renderer: {
        mode: props.renderer,
        buildVolume: 'bed' in (props.buildVolume ?? {}) ? undefined : (props.buildVolume as BuildVolumeDef | undefined),
        quality: props.quality,
        cameraMode: props.cameraMode,
        theme: props.theme,
        colorMode: props.colorMode,
        tube: props.tube,
        adjacentLayers: props.adjacentLayers,
        ...props.rendererOptions
      },
      parseDefaults: props.parseOptions
    });

    // A MachineGeometry buildVolume prop applies post-construction (same consumer-wins effect).
    onMounted(() => {
      if (props.buildVolume !== undefined && 'bed' in props.buildVolume) {
        preview.controls.setBuildVolume(props.buildVolume);
      }
    });

    preview.onEvent((e: PreviewEvent) => {
      switch (e.type) {
        case 'parse-complete':
          emit('ready', {
            segments: e.segments,
            layers: e.layers,
            complete: e.complete,
            capabilities: e.capabilities,
            warnings: e.warnings
          });
          break;
        case 'camera-changed':
          emit('camera-change', e.state);
          break;
        case 'parse-error':
          emit('parse-error', { code: e.code, message: e.message });
          break;
        case 'parse-cancelled':
          emit('parse-cancelled');
          break;
        case 'parse-progress':
          emit('parse-progress', { bytesProcessed: e.progress.bytesProcessed, totalBytes: e.progress.totalBytes });
          break;
        case 'buildComplete':
          emit('build-complete', { segments: e.segments, quality: e.quality });
          emit('disclosure', preview.state.disclosure);
          break;
        case 'qualityFallback':
          emit('quality-fallback', { from: e.from, to: e.to, reason: e.reason });
          break;
        case 'progress-presentation-changed':
          emit(
            'progress-presentation-changed',
            e.reason === undefined ? { mode: e.mode } : { mode: e.mode, reason: e.reason }
          );
          break;
        case 'machine-geometry-discovered':
          emit('machine-geometry-discovered', e.machine);
          break;
        case 'error':
          if (e.code === 'machine-geometry-mismatch') emit('machine-geometry-mismatch', e.message);
          else emit('error', { code: e.code, message: e.message });
          break;
        default:
          break;
      }
    });

    // ---- prop wiring: each prop is a thin call into the composable (D1 shell rule) ----
    //
    // `{ immediate: true }` on every RUNTIME-ONLY prop watcher: Vue's `watch` does not fire on mount
    // by default, so a runtime control prop set at mount time (`:show-travel="false"`, `:layer-range`,
    // `:scrub`, `:view`, …) would otherwise be dropped and only take effect on a later *change* — the
    // initial-state desync the other three adapters don't have (React's `useEffect`, Svelte's `$:`,
    // and Element's `applyRuntimeState()` all apply the initial value on mount). Controls issued before
    // the renderer resolves are queued and replayed, so firing at mount is safe.
    //
    // The CONSTRUCTION-covered props (`colorMode`, `quality`, `cameraMode`, `theme`, and a plain
    // `buildVolume`) are already applied as renderer options at controller creation above, so their
    // watchers stay change-only — making them immediate would just re-apply the same value redundantly.
    watch(
      () => props.source,
      (source) => {
        if (source !== null) void preview.parse(source, props.parseOptions);
      },
      { immediate: true }
    );
    watch(
      () => props.layerRange,
      (range) => {
        if (range === null) preview.controls.setLayerRange(0, Number.POSITIVE_INFINITY);
        else preview.controls.setLayerRange(range[0], range[1]);
      },
      { immediate: true }
    );
    watch(
      () => props.scrub,
      (scrub) => preview.controls.setScrubPosition(scrub),
      { immediate: true }
    );
    watch(
      () => props.scrubTime,
      (t) => preview.controls.setScrubTime(t),
      { immediate: true }
    );
    watch(
      () => props.showTravel,
      (visible) => preview.controls.setKindVisible('travel', visible),
      { immediate: true }
    );
    watch(
      () => props.showWipe,
      (visible) => preview.controls.setKindVisible('wipe', visible),
      { immediate: true }
    );
    watch(
      () => props.showRetractions,
      (visible) => preview.controls.setShowRetractions(visible),
      { immediate: true }
    );
    watch(
      () => props.colorMode,
      (mode) => {
        if (mode !== undefined) preview.controls.setColorMode(mode);
      }
    );
    watch(
      () => props.quality,
      (quality) => preview.controls.setQuality(quality)
    );
    watch(
      () => props.cameraMode,
      (mode) => preview.controls.setCameraMode(mode)
    );
    watch(
      () => props.view,
      (view) => {
        if (view !== undefined) preview.controls.setView(view);
      },
      { immediate: true }
    );
    watch(
      () => props.cameraState,
      (state) => {
        if (state !== undefined && state !== null) preview.controls.setCameraState(state);
      },
      { immediate: true }
    );
    watch(
      () => props.theme,
      (theme) => {
        if (theme !== undefined) preview.controls.setTheme(theme);
      },
      { deep: true }
    );
    watch(
      () => props.buildVolume,
      (volume) => {
        if (volume !== undefined) preview.controls.setBuildVolume(volume);
      }
    );
    watch(
      () => props.progress,
      (obs) => {
        if (obs === null) preview.clearProgress();
        else preview.observeProgress(obs);
      },
      { immediate: true }
    );

    // Template-ref access to the full handle (defineExpose per §4.1).
    expose({ preview });

    const canvasEl = ref<HTMLCanvasElement | null>(null);
    watch(canvasEl, (el) => {
      preview.canvasRef.value = el;
    });
    return () =>
      h('canvas', {
        ref: canvasEl,
        style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' },
        tabindex: '0', // focusable → keyboard camera (DD-004 a11y, #275/M4)
        'aria-label': '3D G-code toolpath preview'
      });
  }
});
