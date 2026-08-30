/**
 * <GcodePreview> — the ready-to-use React component (DD-007 D1 amendment, phase 6).
 *
 * Strictly a SHELL over `useGcodePreview` (D1: never a separate implementation): every
 * prop maps to a hook/controls call, every callback re-fires a controller event, and the
 * full handle is reachable via `ref`. Advanced props are optional with sensible defaults,
 * so `<GcodePreview source={file} />` alone is a working viewer (D4).
 *
 * createElement (no JSX) on purpose: the template is a single full-size <canvas>, and
 * staying pure TypeScript keeps the package on the plain tsc build.
 */
import {
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
  type ReactElement
} from 'react';
import type {
  BuildVolumeDef,
  CameraMode,
  CameraState,
  CameraView,
  ColorMode,
  ProgressivePreview,
  PreparationStage,
  QualityMode,
  QualityPolicy,
  Theme,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import type { FeatureRoleValue, MachineGeometry, ProgressObservation } from '@chestnutlabs/toolpath-core';
import type { WireParseOptions, WorkerLike } from '@chestnutlabs/gcode-parser';
import {
  useGcodePreview,
  type GcodePreviewHandle,
  type PreviewEvent,
  type RendererMode,
  type UseGcodePreviewOptions
} from './use-gcode-preview.js';

export type GcodePreviewSource = Uint8Array | ArrayBuffer | File | null;

export interface GcodePreviewProps {
  /** The one prop needed in practice: bytes/File to parse. Changing it re-parses. */
  source?: GcodePreviewSource;
  parseOptions?: WireParseOptions;
  /**
   * DD-014 D5: which renderer backs the preview — `'3d'` (default, Three.js) or `'2d'` (the
   * low-resource Canvas layer view). Three.js is loaded on demand, so `'2d'` never ships it.
   */
  renderer?: RendererMode;
  /** 2D only (`renderer="2d"`): preceding "ghost" layers beneath the active one (default 1, floor 0). */
  adjacentLayers?: number;
  /** Consumer-configured volume — wins over file-discovered geometry (DD-005 precedence). */
  buildVolume?: BuildVolumeDef | MachineGeometry;
  quality?: QualityMode | 'auto';
  /** Fidelity policy (DD-023 §4 D6): 'full' | 'adaptive' | 'fast'. 3D only. */
  qualityMode?: QualityPolicy;
  /** #60 curtain: 'lines' (default, stream the preview), 'hold' (reveal only the final build), or 'off'. 3D only. */
  progressivePreview?: ProgressivePreview;
  /** #150 (DD-009 D3): camera projection. */
  cameraMode?: CameraMode;
  /** #306/#6: frame the printed 'object' (excl. skirt/prime) or 'all' extrusion. Default 'all'. */
  frameContent?: 'object' | 'all';
  /** #306/2 (DD-020): 'auto' reduces detail while the camera moves. Default 'off'. */
  interactionQuality?: 'off' | 'auto';
  /** #268/#275/M6: snap to a preset orientation (top/front/iso/…). Instant; preserves the projection. */
  view?: CameraView;
  /** #268/#275/M6: restore a saved camera pose. Pair with `onCameraChange` for a two-way binding. */
  cameraState?: CameraState | null;
  /** #153 (DD-009 D4): bounded declarative theme. */
  theme?: Theme;
  colorMode?: ColorMode;
  tube?: TubeOptions;
  /** Inclusive [start, end]; null/undefined shows every layer. */
  layerRange?: [number, number] | null;
  /** Scrub cut (IR segment index); null shows everything up to the layer range. */
  scrub?: number | null;
  /** Time-based scrub cut in ms of print time (#181); null clears it. */
  scrubTime?: number | null;
  showTravel?: boolean;
  /** DD-016 (#182): show slicer wipe moves. Default true; set false to hide the wipe chunk. */
  showWipe?: boolean;
  /** DD-009 D1 (#148): opt-in retraction/deretraction markers. */
  showRetractions?: boolean;
  /** #306/#6: show the build-volume wireframe cage (independent of the bed/plate). Default true. */
  showVolumeCage?: boolean;
  /** DD-031 G3: feature roles to hide (e.g. `[FeatureRole.Skirt, FeatureRole.Brim]`). Declarative form
   *  of `controls.setFeatureRoleVisible`; gate on `capabilities.featureRoles`. */
  hiddenFeatureRoles?: FeatureRoleValue[];
  /** DD-006 live progress observation; null hides the overlay. */
  progress?: ProgressObservation | null;
  /** Worker factory escape hatch (DD-005 slim/custom entries; D2). */
  createWorker?: () => WorkerLike;
  /** Advanced/test renderer injectables (pass-throughs of the renderer contract). */
  rendererOptions?: Omit<
    NonNullable<UseGcodePreviewOptions['renderer']>,
    | 'buildVolume'
    | 'quality'
    | 'qualityMode'
    | 'progressivePreview'
    | 'cameraMode'
    | 'frameContent'
    | 'interactionQuality'
    | 'theme'
    | 'colorMode'
    | 'tube'
  >;
  onReady?: (summary: {
    segments: number;
    layers: number;
    complete: boolean;
    capabilities: Record<string, import('@chestnutlabs/toolpath-core').Confidence>;
    warnings: readonly import('@chestnutlabs/toolpath-core').Warning[];
    metadata: import('@chestnutlabs/toolpath-core').DialectMetadata | undefined;
  }) => void;
  /** #275/M6: fires after a user camera interaction settles, with the new serializable state. */
  onCameraChange?: (state: CameraState) => void;
  onParseError?: (e: { code: string; message: string }) => void;
  onParseCancelled?: () => void;
  onParseProgress?: (p: { bytesProcessed: number; totalBytes: number }) => void;
  /** DD-029 staged preparation progress (`building-geometry` carries a real `progress` + counts). */
  onStage?: (e: { stage: PreparationStage; progress?: number; detail?: { built: number; total: number } }) => void;
  onBuildComplete?: (e: { segments: number; quality: QualityMode }) => void;
  onQualityFallback?: (e: { from: QualityMode; to: QualityMode; reason: string }) => void;
  onMachineGeometryMismatch?: (message: string) => void;
  onMachineGeometryDiscovered?: (machine: MachineGeometry) => void;
  onProgressPresentationChanged?: (e: { mode: string; reason?: string }) => void;
  onDisclosure?: (text: string) => void;
  onError?: (e: { code: string; message: string }) => void;
}

function GcodePreviewImpl(props: GcodePreviewProps, ref: ForwardedRef<GcodePreviewHandle>): ReactElement {
  const isMachine = props.buildVolume !== undefined && 'bed' in props.buildVolume;
  const preview = useGcodePreview({
    createWorker: props.createWorker,
    renderer: {
      mode: props.renderer,
      buildVolume: isMachine ? undefined : (props.buildVolume as BuildVolumeDef | undefined),
      quality: props.quality ?? 'auto',
      qualityMode: props.qualityMode,
      progressivePreview: props.progressivePreview,
      cameraMode: props.cameraMode ?? 'perspective',
      frameContent: props.frameContent ?? 'all',
      interactionQuality: props.interactionQuality ?? 'off',
      theme: props.theme,
      colorMode: props.colorMode,
      tube: props.tube,
      adjacentLayers: props.adjacentLayers,
      ...props.rendererOptions
    },
    parseDefaults: props.parseOptions
  });
  useImperativeHandle(ref, () => preview, [preview]);

  // Callbacks live in a ref so the event subscription is stable across renders.
  const cbRef = useRef(props);
  cbRef.current = props;
  // Tracks which roles THIS prop last hid, so we diff prev→next and don't disturb roles hidden elsewhere.
  const prevHiddenRef = useRef<FeatureRoleValue[]>([]);
  useEffect(() => {
    return preview.onEvent((e: PreviewEvent) => {
      const p = cbRef.current;
      switch (e.type) {
        case 'parse-complete':
          p.onReady?.({
            segments: e.segments,
            layers: e.layers,
            complete: e.complete,
            capabilities: e.capabilities,
            warnings: e.warnings,
            metadata: e.metadata
          });
          break;
        case 'camera-changed':
          p.onCameraChange?.(e.state);
          break;
        case 'parse-error':
          p.onParseError?.({ code: e.code, message: e.message });
          break;
        case 'parse-cancelled':
          p.onParseCancelled?.();
          break;
        case 'parse-progress':
          p.onParseProgress?.({ bytesProcessed: e.progress.bytesProcessed, totalBytes: e.progress.totalBytes });
          break;
        case 'stage':
          p.onStage?.({ stage: e.stage, progress: e.progress, detail: e.detail });
          break;
        case 'buildComplete':
          p.onBuildComplete?.({ segments: e.segments, quality: e.quality });
          p.onDisclosure?.(preview.state.disclosure);
          break;
        case 'qualityFallback':
          p.onQualityFallback?.({ from: e.from, to: e.to, reason: e.reason });
          break;
        case 'progress-presentation-changed':
          p.onProgressPresentationChanged?.(
            e.reason === undefined ? { mode: e.mode } : { mode: e.mode, reason: e.reason }
          );
          break;
        case 'machine-geometry-discovered':
          p.onMachineGeometryDiscovered?.(e.machine);
          break;
        case 'error':
          if (e.code === 'machine-geometry-mismatch') p.onMachineGeometryMismatch?.(e.message);
          else p.onError?.({ code: e.code, message: e.message });
          break;
        default:
          break;
      }
    });
  }, []);

  // ---- prop wiring: each prop is a thin call into the hook (D1 shell rule) ----
  const {
    source,
    layerRange,
    scrub,
    scrubTime,
    showTravel,
    showWipe,
    showRetractions,
    showVolumeCage,
    colorMode,
    quality,
    qualityMode,
    progressivePreview,
    cameraMode,
    frameContent,
    interactionQuality,
    view,
    cameraState,
    theme,
    buildVolume,
    hiddenFeatureRoles,
    progress
  } = props;
  useEffect(() => {
    if (source !== null && source !== undefined) void preview.parse(source, cbRef.current.parseOptions);
  }, [source]);
  useEffect(() => {
    if (layerRange === null || layerRange === undefined) preview.controls.setLayerRange(0, Number.POSITIVE_INFINITY);
    else preview.controls.setLayerRange(layerRange[0], layerRange[1]);
  }, [layerRange]);
  useEffect(() => {
    preview.controls.setScrubPosition(scrub ?? null);
  }, [scrub]);
  useEffect(() => {
    preview.controls.setScrubTime(scrubTime ?? null);
  }, [scrubTime]);
  useEffect(() => {
    preview.controls.setKindVisible('travel', showTravel ?? true);
  }, [showTravel]);
  useEffect(() => {
    preview.controls.setKindVisible('wipe', showWipe ?? true);
  }, [showWipe]);
  useEffect(() => {
    preview.controls.setShowRetractions(showRetractions ?? false);
  }, [showRetractions]);
  useEffect(() => {
    preview.controls.setBuildVolumeCage(showVolumeCage ?? true);
  }, [showVolumeCage]);
  useEffect(() => {
    if (colorMode !== undefined) preview.controls.setColorMode(colorMode);
  }, [colorMode]);
  useEffect(() => {
    if (quality !== undefined) preview.controls.setQuality(quality);
  }, [quality]);
  useEffect(() => {
    if (qualityMode !== undefined) preview.controls.setQualityMode(qualityMode);
  }, [qualityMode]);
  useEffect(() => {
    if (progressivePreview !== undefined) preview.controls.setProgressivePreview(progressivePreview);
  }, [progressivePreview]);
  useEffect(() => {
    if (cameraMode !== undefined) preview.controls.setCameraMode(cameraMode);
  }, [cameraMode]);
  useEffect(() => {
    if (frameContent !== undefined) preview.controls.setFrameContent(frameContent);
  }, [frameContent]);
  useEffect(() => {
    if (interactionQuality !== undefined) preview.controls.setInteractionQuality(interactionQuality);
  }, [interactionQuality]);
  useEffect(() => {
    if (view !== undefined) preview.controls.setView(view);
  }, [view]);
  useEffect(() => {
    if (cameraState !== undefined && cameraState !== null) preview.controls.setCameraState(cameraState);
  }, [cameraState]);
  useEffect(() => {
    if (theme !== undefined) preview.controls.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (buildVolume !== undefined && 'bed' in buildVolume) preview.controls.setBuildVolume(buildVolume);
  }, [buildVolume]);
  useEffect(() => {
    // Feature-role visibility (DD-031 G3): diff prev→next so we only toggle roles this prop owns.
    const next = hiddenFeatureRoles ?? [];
    const prev = prevHiddenRef.current;
    for (const role of prev) if (!next.includes(role)) preview.controls.setFeatureRoleVisible(role, true);
    for (const role of next) if (!prev.includes(role)) preview.controls.setFeatureRoleVisible(role, false);
    prevHiddenRef.current = [...next];
  }, [hiddenFeatureRoles]);
  useEffect(() => {
    if (progress === null || progress === undefined) preview.clearProgress();
    else preview.observeProgress(progress);
  }, [progress]);

  return createElement('canvas', {
    ref: preview.canvasRef,
    style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' },
    tabIndex: 0, // focusable → keyboard camera (DD-004 a11y, #275/M4)
    'aria-label': '3D G-code toolpath preview'
  });
}

/** Ready-to-use viewer: `<GcodePreview source={file} />` works alone (D4). */
export const GcodePreview = forwardRef(GcodePreviewImpl);
