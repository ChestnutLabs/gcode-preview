/**
 * <ModelViewer> — the ready-to-use React component for interactive source-model viewing (STL / 3MF),
 * the Prepare-side counterpart to <GcodePreview> (DD-031). A SHELL over `useModelViewer`: every prop
 * maps to a controls call, every callback re-fires a controller event, and the full handle is reachable
 * via `ref`. `<ModelViewer source={file} />` alone is a working viewer.
 *
 * createElement (no JSX) on purpose — the template is a single full-size <canvas>.
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
  CameraMode,
  CameraState,
  CameraView,
  GLRendererLike,
  InteractiveStageOptions,
  LoadProgress,
  RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import type {
  ModelBackground,
  ModelLimits,
  ModelLoader,
  ModelReadyInfo,
  ModelSourceInput,
  ModelViewerEvent,
  PresentationView,
  RenderScope
} from '@chestnutlabs/gcode-model-renderer';
import { useModelViewer, type ModelViewerHandle } from './use-model-viewer.js';

export type ModelViewerSource = ModelSourceInput | null;

export interface ModelViewerProps {
  /** The one prop needed in practice: the source model. Changing it re-parses. */
  source?: ModelViewerSource;
  /** Snap to a preset orientation (shared vocabulary with the toolpath camera). */
  view?: PresentationView | CameraView;
  /** Restore a saved camera pose. Pair with `onCameraChange` for a two-way binding. */
  cameraState?: CameraState | null;
  /** `'transparent'` (default) | CSS colour | `0xRRGGBB`. */
  background?: ModelBackground;
  /** DD-020 interaction-aware quality; default `'auto'`. */
  interactionQuality?: 'off' | 'auto';
  /** Initial camera projection; default `'perspective'`. */
  cameraMode?: CameraMode;
  /** Render only a subset: `{ plateId }` / `{ objectIds }` / `{ instanceFilter }`; null = whole source. */
  renderScope?: RenderScope | null;
  /** Source-model triangle / byte caps. */
  limits?: ModelLimits;
  /** 3MF `paint_color` palette override (hex per 0-based slot). */
  filamentPalette?: readonly (string | undefined)[];
  /** Loader registry (open `kind`). Default: STL + 3MF. */
  loaders?: readonly ModelLoader[];
  /** Advanced/test: inject GL / orbit controls. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  createControls?: NonNullable<InteractiveStageOptions['createControls']>;
  onReady?: (info: ModelReadyInfo) => void;
  onCameraChange?: (state: CameraState) => void;
  onError?: (e: { code: string; message: string }) => void;
  onRendererUnsupported?: (e: { feature: string; message: string }) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onProgress?: (progress: LoadProgress) => void;
}

function ModelViewerImpl(props: ModelViewerProps, ref: ForwardedRef<ModelViewerHandle>): ReactElement {
  const {
    source = null,
    view,
    cameraState,
    background,
    interactionQuality,
    cameraMode,
    renderScope,
    limits,
    filamentPalette,
    loaders,
    createRenderer,
    createControls
  } = props;

  // Construction-time options (stable for the controller's lifetime).
  const viewer = useModelViewer({
    ...(background !== undefined ? { background } : {}),
    ...(interactionQuality !== undefined ? { interactionQuality } : {}),
    ...(cameraMode !== undefined ? { cameraMode } : {}),
    ...(limits !== undefined ? { limits } : {}),
    ...(filamentPalette !== undefined ? { filamentPalette } : {}),
    ...(loaders !== undefined ? { loaders } : {}),
    ...(renderScope != null ? { renderScope } : {}),
    ...(createRenderer !== undefined ? { createRenderer } : {}),
    ...(createControls !== undefined ? { createControls } : {}),
    onProgress: (p) => cbRef.current.onProgress?.(p)
  });

  useImperativeHandle(ref, () => viewer, [viewer]);

  // Latest callbacks without re-subscribing the event bridge.
  const cbRef = useRef(props);
  cbRef.current = props;

  useEffect(() => {
    return viewer.onEvent((e: ModelViewerEvent) => {
      const cb = cbRef.current;
      switch (e.type) {
        case 'ready':
          cb.onReady?.(e.info);
          break;
        case 'camera-changed':
          cb.onCameraChange?.(e.state);
          break;
        case 'error':
          cb.onError?.({ code: e.code, message: e.message });
          break;
        case 'renderer-unsupported':
          cb.onRendererUnsupported?.({ feature: e.feature, message: e.message });
          break;
        case 'context-lost':
          cb.onContextLost?.();
          break;
        case 'context-restored':
          cb.onContextRestored?.();
          break;
        default:
          break;
      }
    });
  }, [viewer]);

  // ---- runtime prop wiring (each a thin controls call) ----
  useEffect(() => {
    if (source !== null && source !== undefined) void viewer.controls.setSource(source);
  }, [viewer, source]);
  useEffect(() => {
    if (view !== undefined) viewer.controls.setView(view);
  }, [viewer, view]);
  useEffect(() => {
    if (cameraState !== undefined && cameraState !== null) viewer.controls.setCameraState(cameraState);
  }, [viewer, cameraState]);
  useEffect(() => {
    if (background !== undefined) viewer.controls.setBackground(background);
  }, [viewer, background]);
  useEffect(() => {
    if (interactionQuality !== undefined) viewer.controls.setInteractionQuality(interactionQuality);
  }, [viewer, interactionQuality]);
  useEffect(() => {
    if (renderScope !== undefined) viewer.controls.setRenderScope(renderScope);
  }, [viewer, renderScope]);

  return createElement('canvas', {
    ref: viewer.canvasRef,
    style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' },
    tabIndex: 0,
    'aria-label': '3D source-model preview'
  });
}

export const ModelViewer = forwardRef(ModelViewerImpl);
