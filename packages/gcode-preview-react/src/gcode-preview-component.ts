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
  ColorMode,
  QualityMode,
  Theme,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import type { MachineGeometry, ProgressObservation } from '@chestnutlabs/toolpath-core';
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
  /** #150 (DD-009 D3): camera projection. */
  cameraMode?: CameraMode;
  /** #153 (DD-009 D4): bounded declarative theme. */
  theme?: Theme;
  colorMode?: ColorMode;
  tube?: TubeOptions;
  /** Inclusive [start, end]; null/undefined shows every layer. */
  layerRange?: [number, number] | null;
  /** Scrub cut (IR segment index); null shows everything up to the layer range. */
  scrub?: number | null;
  showTravel?: boolean;
  /** DD-009 D1 (#148): opt-in retraction/deretraction markers. */
  showRetractions?: boolean;
  /** DD-006 live progress observation; null hides the overlay. */
  progress?: ProgressObservation | null;
  /** Worker factory escape hatch (DD-005 slim/custom entries; D2). */
  createWorker?: () => WorkerLike;
  /** Advanced/test renderer injectables (pass-throughs of the renderer contract). */
  rendererOptions?: Omit<
    NonNullable<UseGcodePreviewOptions['renderer']>,
    'buildVolume' | 'quality' | 'cameraMode' | 'theme' | 'colorMode' | 'tube'
  >;
  onReady?: (summary: { segments: number; layers: number; complete: boolean }) => void;
  onParseError?: (e: { code: string; message: string }) => void;
  onParseCancelled?: () => void;
  onParseProgress?: (p: { bytesProcessed: number; totalBytes: number }) => void;
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
      cameraMode: props.cameraMode ?? 'perspective',
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
  useEffect(() => {
    return preview.onEvent((e: PreviewEvent) => {
      const p = cbRef.current;
      switch (e.type) {
        case 'parse-complete':
          p.onReady?.({ segments: e.segments, layers: e.layers, complete: e.complete });
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
    showTravel,
    showRetractions,
    colorMode,
    quality,
    cameraMode,
    theme,
    buildVolume,
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
    preview.controls.setKindVisible('travel', showTravel ?? true);
  }, [showTravel]);
  useEffect(() => {
    preview.controls.setShowRetractions(showRetractions ?? false);
  }, [showRetractions]);
  useEffect(() => {
    if (colorMode !== undefined) preview.controls.setColorMode(colorMode);
  }, [colorMode]);
  useEffect(() => {
    if (quality !== undefined) preview.controls.setQuality(quality);
  }, [quality]);
  useEffect(() => {
    if (cameraMode !== undefined) preview.controls.setCameraMode(cameraMode);
  }, [cameraMode]);
  useEffect(() => {
    if (theme !== undefined) preview.controls.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (buildVolume !== undefined && 'bed' in buildVolume) preview.controls.setBuildVolume(buildVolume);
  }, [buildVolume]);
  useEffect(() => {
    if (progress === null || progress === undefined) preview.clearProgress();
    else preview.observeProgress(progress);
  }, [progress]);

  return createElement('canvas', {
    ref: preview.canvasRef,
    style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' },
    'aria-label': '3D G-code toolpath preview'
  });
}

/** Ready-to-use viewer: `<GcodePreview source={file} />` works alone (D4). */
export const GcodePreview = forwardRef(GcodePreviewImpl);
