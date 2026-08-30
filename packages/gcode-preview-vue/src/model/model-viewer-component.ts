/**
 * <ModelViewer> — the ready-to-use Vue component for interactive source-model viewing (STL / 3MF),
 * the Prepare-side counterpart to <GcodePreview> (DD-031). A SHELL over `useModelViewer`: every prop
 * maps to a composable/controls call, every emit re-fires a controller event, and the handle is
 * exposed via `defineExpose`. Render-function component (no SFC) — the template is a single <canvas>.
 */
import { defineComponent, h, ref, watch, type PropType } from 'vue';
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
  PresentationView,
  RenderScope
} from '@chestnutlabs/gcode-model-renderer';
import { useModelViewer, type ModelViewerEvent } from './use-model-viewer.js';

export type ModelViewerSource = ModelSourceInput | null;

export const ModelViewer = defineComponent({
  name: 'ModelViewer',
  props: {
    /** The one required-in-practice prop: the source model. Changing it re-parses. */
    source: { type: [Object, Uint8Array, ArrayBuffer] as PropType<ModelViewerSource>, default: null },
    /** Snap to a preset orientation (shared vocabulary with the toolpath camera). */
    view: { type: String as PropType<PresentationView | CameraView>, default: undefined },
    /** Restore a saved camera pose. Pair with `@camera-change` for two-way binding. */
    cameraState: { type: Object as PropType<CameraState | null>, default: undefined },
    /** `'transparent'` (default) | CSS colour | `0xRRGGBB`. */
    background: { type: [String, Number] as PropType<ModelBackground>, default: undefined },
    /** DD-020 interaction-aware quality; default `'auto'`. */
    interactionQuality: { type: String as PropType<'off' | 'auto'>, default: undefined },
    /** Initial camera projection; default `'perspective'`. */
    cameraMode: { type: String as PropType<CameraMode>, default: undefined },
    /** Render only a subset: `{ plateId }` / `{ objectIds }` / `{ instanceFilter }`; null = whole source. */
    renderScope: { type: Object as PropType<RenderScope | null>, default: undefined },
    /** Source-model triangle / byte caps. */
    limits: { type: Object as PropType<ModelLimits>, default: undefined },
    /** 3MF `paint_color` palette override (hex per 0-based slot). */
    filamentPalette: { type: Array as PropType<readonly (string | undefined)[]>, default: undefined },
    /** Loader registry (open `kind`). Default: STL + 3MF. */
    loaders: { type: Array as PropType<readonly ModelLoader[]>, default: undefined },
    /** Advanced/test: inject GL / orbit controls. */
    createRenderer: {
      type: Function as PropType<(canvas: RenderTargetCanvas) => GLRendererLike>,
      default: undefined
    },
    createControls: {
      type: Function as PropType<NonNullable<InteractiveStageOptions['createControls']>>,
      default: undefined
    }
  },
  emits: {
    /* eslint-disable @typescript-eslint/no-unused-vars -- emit validators document payloads */
    ready: (_info: ModelReadyInfo) => true,
    'camera-change': (_state: CameraState) => true,
    error: (_e: { code: string; message: string }) => true,
    'renderer-unsupported': (_e: { feature: string; message: string }) => true,
    'context-lost': () => true,
    'context-restored': () => true,
    progress: (_p: LoadProgress) => true
    /* eslint-enable @typescript-eslint/no-unused-vars */
  },
  setup(props, { emit, expose }) {
    const viewer = useModelViewer({
      ...(props.background !== undefined ? { background: props.background } : {}),
      ...(props.interactionQuality !== undefined ? { interactionQuality: props.interactionQuality } : {}),
      ...(props.cameraMode !== undefined ? { cameraMode: props.cameraMode } : {}),
      ...(props.limits !== undefined ? { limits: props.limits } : {}),
      ...(props.filamentPalette !== undefined ? { filamentPalette: props.filamentPalette } : {}),
      ...(props.loaders !== undefined ? { loaders: props.loaders } : {}),
      ...(props.renderScope != null ? { renderScope: props.renderScope } : {}),
      ...(props.createRenderer !== undefined ? { createRenderer: props.createRenderer } : {}),
      ...(props.createControls !== undefined ? { createControls: props.createControls } : {}),
      onProgress: (p) => emit('progress', p)
    });

    viewer.onEvent((e: ModelViewerEvent) => {
      switch (e.type) {
        case 'ready':
          emit('ready', e.info);
          break;
        case 'camera-changed':
          emit('camera-change', e.state);
          break;
        case 'error':
          emit('error', { code: e.code, message: e.message });
          break;
        case 'renderer-unsupported':
          emit('renderer-unsupported', { feature: e.feature, message: e.message });
          break;
        case 'context-lost':
          emit('context-lost');
          break;
        case 'context-restored':
          emit('context-restored');
          break;
        default:
          break;
      }
    });

    // Runtime-only props apply immediately on mount (Vue's watch is change-only by default).
    watch(
      () => props.source,
      (source) => {
        if (source !== null && source !== undefined) void viewer.controls.setSource(source);
      },
      { immediate: true }
    );
    watch(
      () => props.view,
      (view) => {
        if (view !== undefined) viewer.controls.setView(view);
      },
      { immediate: true }
    );
    watch(
      () => props.cameraState,
      (state) => {
        if (state !== undefined && state !== null) viewer.controls.setCameraState(state);
      },
      { immediate: true }
    );
    watch(
      () => props.background,
      (bg) => {
        if (bg !== undefined) viewer.controls.setBackground(bg);
      }
    );
    watch(
      () => props.interactionQuality,
      (mode) => {
        if (mode !== undefined) viewer.controls.setInteractionQuality(mode);
      }
    );
    watch(
      () => props.renderScope,
      (scope) => {
        if (scope !== undefined) viewer.controls.setRenderScope(scope);
      }
    );

    expose({ viewer });

    const canvasEl = ref<HTMLCanvasElement | null>(null);
    watch(canvasEl, (el) => {
      viewer.canvasRef.value = el;
    });
    return () =>
      h('canvas', {
        ref: canvasEl,
        style: { width: '100%', height: '100%', display: 'block', touchAction: 'none' },
        tabindex: '0',
        'aria-label': '3D source-model preview'
      });
  }
});
