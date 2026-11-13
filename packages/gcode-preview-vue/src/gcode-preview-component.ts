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
  PixelRatioOption,
  QualityMode,
  ProgressivePreview,
  PreparationStage,
  QualityPolicy,
  Theme,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import type { Confidence, DialectMetadata, Warning } from '@chestnutlabs/toolpath-core';
import type { FeatureRoleValue, MachineGeometry, ProgressObservation } from '@chestnutlabs/toolpath-core';
import type { WireParseOptions, WorkerLike } from '@chestnutlabs/gcode-parser';
import {
  useGcodePreview,
  type PreviewError,
  type PreviewEvent,
  type RendererMode,
  type UseGcodePreviewOptions
} from './use-gcode-preview.js';

export type GcodePreviewSource = Uint8Array | ArrayBuffer | File | null;

/** The perspective lens every renderer starts with, in degrees (#520: a mount value of 50 asks for nothing). */
const DEFAULT_LENS = 50;

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
    qualityMode: { type: String as PropType<QualityPolicy>, default: undefined },
    /** #60 curtain: 'lines' (default, stream the preview), 'hold' (reveal only the final build), or 'off'. */
    progressivePreview: { type: String as PropType<ProgressivePreview>, default: undefined },
    /** #150 (DD-009 D3): camera projection. */
    cameraMode: { type: String as PropType<CameraMode>, default: 'perspective' },
    /** DD-032: perspective lens in degrees, [10, 120] (default 50; `STUDIO_CAMERA_FOV` = 32). Unset keeps the
     *  current lens. Out of range throws `RangeError` (never clamped). 3D only. */
    cameraFov: { type: Number as PropType<number>, default: undefined },
    /** Resting pixel ratio of the canvas: a number in (0, 4], or 'device' (the display's
     *  devicePixelRatio capped at 2, followed live). Unset keeps the renderer's ratio (1). A ratio of 2 shades
     *  4x the fragments of 1. Out of range throws RangeError (never clamped). 3D only. */
    pixelRatio: { type: [Number, String] as PropType<PixelRatioOption>, default: undefined },
    /** #306/#6: frame the printed 'object' (excl. skirt/prime) or 'all' extrusion. Default 'all'. */
    frameContent: { type: String as PropType<'object' | 'all'>, default: 'all' },
    /** #306/2 (DD-020): 'auto' reduces detail while the camera moves. Default 'off'. */
    interactionQuality: { type: String as PropType<'off' | 'auto'>, default: 'off' },
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
    /** #306/#6: show the build-volume wireframe cage (independent of the bed/plate). Default true. */
    showVolumeCage: { type: Boolean, default: true },
    /** DD-031 G3: feature roles to hide (e.g. `[FeatureRole.Skirt, FeatureRole.Brim]` to declutter a
     *  part). Declarative form of `controls.setFeatureRoleVisible`; gate on `capabilities.featureRoles`. */
    hiddenFeatureRoles: { type: Array as PropType<FeatureRoleValue[]>, default: undefined },
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
          | 'buildVolume'
          | 'quality'
          | 'qualityMode'
          | 'progressivePreview'
          | 'cameraMode'
          | 'cameraFov'
          | 'pixelRatio'
          | 'frameContent'
          | 'interactionQuality'
          | 'theme'
          | 'colorMode'
          | 'tube'
        >
      >,
      default: undefined
    }
  },
  emits: {
    ready: (_summary: {
      segments: number;
      layers: number;
      complete: boolean;
      capabilities: Record<string, Confidence>;
      warnings: readonly Warning[];
      metadata: DialectMetadata | undefined;
    }) => true,
    'camera-change': (_state: CameraState) => true,
    'parse-error': (_e: PreviewError) => true,
    'parse-cancelled': () => true,
    'parse-progress': (_p: { bytesProcessed: number; totalBytes: number }) => true,
    stage: (_e: { stage: PreparationStage; progress?: number; detail?: { built: number; total: number } }) => true,
    'build-complete': (_e: { segments: number; quality: QualityMode }) => true,
    'quality-fallback': (_e: { from: QualityMode; to: QualityMode; reason: string }) => true,
    'machine-geometry-mismatch': (_message: string) => true,
    'machine-geometry-discovered': (_machine: MachineGeometry) => true,
    'progress-presentation-changed': (_e: { mode: string; reason?: string }) => true,
    disclosure: (_text: string) => true,
    /** #520: the renderer cannot honour a requested setting (e.g. a lens on the 2D renderer); once per request. */
    'renderer-unsupported': (_e: { feature: string; message: string }) => true,
    error: (_e: PreviewError) => true
  },
  setup(props, { emit, expose }) {
    const preview = useGcodePreview({
      createWorker: props.createWorker,
      renderer: {
        mode: props.renderer,
        buildVolume: 'bed' in (props.buildVolume ?? {}) ? undefined : (props.buildVolume as BuildVolumeDef | undefined),
        quality: props.quality,
        qualityMode: props.qualityMode,
        progressivePreview: props.progressivePreview,
        cameraMode: props.cameraMode,
        cameraFov: props.cameraFov,
        pixelRatio: props.pixelRatio,
        frameContent: props.frameContent,
        interactionQuality: props.interactionQuality,
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
            warnings: e.warnings,
            metadata: e.metadata
          });
          break;
        case 'camera-changed':
          emit('camera-change', e.state);
          break;
        case 'parse-error': {
          // The whole error, `cause` and `reason` included, without the event's `type`.
          const { type: _type, ...error } = e;
          emit('parse-error', error);
          break;
        }
        case 'parse-cancelled':
          emit('parse-cancelled');
          break;
        case 'parse-progress':
          emit('parse-progress', { bytesProcessed: e.progress.bytesProcessed, totalBytes: e.progress.totalBytes });
          break;
        case 'stage':
          emit('stage', { stage: e.stage, progress: e.progress, detail: e.detail });
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
        case 'error': {
          const { type: _type, ...error } = e;
          if (e.code === 'machine-geometry-mismatch') emit('machine-geometry-mismatch', e.message);
          else emit('error', error);
          break;
        }
        case 'renderer-unsupported':
          emit('renderer-unsupported', { feature: e.feature, message: e.message });
          break;
        default:
          break;
      }
    });

    // #520: the 2D renderer cannot honour these four 3D-only construction props, so one set to a non-default
    // value at mount is also applied through controls, and 2D reports `renderer-unsupported` once. 3D was
    // built with them, so it skips this (a re-applied quality would rebuild). Subscribed above first.
    if (props.renderer === '2d') {
      if (props.quality !== 'auto') preview.controls.setQuality(props.quality);
      if (props.cameraMode !== 'perspective') preview.controls.setCameraMode(props.cameraMode);
      if (props.cameraFov !== undefined && props.cameraFov !== DEFAULT_LENS) {
        preview.controls.setCameraFov(props.cameraFov);
      }
      if (props.pixelRatio !== undefined) preview.controls.setPixelRatio(props.pixelRatio);
    }

    // ---- prop wiring: each prop is a thin call into the composable (D1 shell rule) ----
    //
    // `{ immediate: true }` on every RUNTIME-ONLY prop watcher: Vue's `watch` does not fire on mount
    // by default, so a runtime control prop set at mount time (`:show-travel="false"`, `:layer-range`,
    // `:scrub`, `:view`, …) would otherwise be dropped and only take effect on a later *change* — the
    // initial-state desync the other three adapters don't have (React's `useEffect`, Svelte's `$:`,
    // and Element's `applyRuntimeState()` all apply the initial value on mount). Controls issued before
    // the renderer resolves are queued and replayed, so firing at mount is safe.
    //
    // The CONSTRUCTION-covered props (`colorMode`, `quality`, `cameraMode`, `cameraFov`, `pixelRatio`, `theme`, and a plain
    // `buildVolume`) are already applied as renderer options at controller creation above, so their
    // watchers stay change-only — making them immediate would just re-apply the same value redundantly.
    // (On the 2D renderer the four 3D-only ones are also applied once at mount when non-default; see #520.)
    let sourceParsed = false;
    watch(
      () => props.source,
      (source) => {
        if (source === null) return;
        void preview.parse(source, props.parseOptions);
        // On a source change a renderer shows the new file uncut, so re-send the view props that still hold a
        // value: the controller applies them to the file that parse loads. scrubTime goes last, so it wins over
        // scrub (as at mount). The first parse needs none: the immediate watchers below send them at mount.
        const first = !sourceParsed;
        sourceParsed = true;
        if (first) return;
        const range = props.layerRange;
        if (range !== null) preview.controls.setLayerRange(range[0], range[1]);
        if (props.scrub !== null) preview.controls.setScrubPosition(props.scrub);
        if (props.scrubTime !== null) preview.controls.setScrubTime(props.scrubTime);
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
    // The scrub values last sent from the props. A null prop is sent (as a clear) only when it replaces a sent
    // number, so an unset `scrubTime` at mount no longer clears the `scrub` cut.
    let scrubSent: number | null = null;
    let scrubTimeSent: number | null = null;
    watch(
      () => props.scrub,
      (scrub) => {
        if (scrub === null && scrubSent === null) return;
        scrubSent = scrub;
        preview.controls.setScrubPosition(scrub);
      },
      { immediate: true }
    );
    watch(
      () => props.scrubTime,
      (t) => {
        if (t === null && scrubTimeSent === null) return;
        scrubTimeSent = t;
        preview.controls.setScrubTime(t);
      },
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
      () => props.showVolumeCage,
      (visible) => preview.controls.setBuildVolumeCage(visible),
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
      () => props.qualityMode,
      (mode) => {
        if (mode !== undefined) preview.controls.setQualityMode(mode);
      }
    );
    watch(
      () => props.progressivePreview,
      (mode) => {
        if (mode !== undefined) preview.controls.setProgressivePreview(mode);
      }
    );
    watch(
      () => props.cameraMode,
      (mode) => preview.controls.setCameraMode(mode)
    );
    watch(
      () => props.cameraFov,
      (fov) => {
        if (fov !== undefined) preview.controls.setCameraFov(fov);
      }
    );
    watch(
      () => props.pixelRatio,
      (ratio) => {
        if (ratio !== undefined) preview.controls.setPixelRatio(ratio);
      }
    );
    watch(
      () => props.frameContent,
      (mode) => preview.controls.setFrameContent(mode)
    );
    watch(
      () => props.interactionQuality,
      (mode) => preview.controls.setInteractionQuality(mode)
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
    // Feature-role visibility (DD-031 G3): diff prev→next so we only toggle roles this prop owns,
    // leaving any role hidden imperatively elsewhere untouched.
    let prevHiddenRoles: FeatureRoleValue[] = [];
    watch(
      () => props.hiddenFeatureRoles,
      (roles) => {
        const next = roles ?? [];
        for (const role of prevHiddenRoles)
          if (!next.includes(role)) preview.controls.setFeatureRoleVisible(role, true);
        for (const role of next)
          if (!prevHiddenRoles.includes(role)) preview.controls.setFeatureRoleVisible(role, false);
        prevHiddenRoles = [...next];
      },
      { immediate: true }
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
