/**
 * useModelViewer — the Vue reactivity bridge for interactive **source-model** viewing (the Prepare
 * side), the analogue of `useGcodePreview` for the toolpath/Preview side (DD-031). Owns only the
 * Vue-isms: a canvas template ref, a shallow-reactive state mirror fed by controller snapshots, and
 * scope-tied disposal. The engine/state/contracts live in `@chestnutlabs/gcode-model-renderer` and are
 * re-exported, never redeclared (the D1 drift firewall).
 */
import { getCurrentScope, onScopeDispose, readonly, ref, shallowReactive, watch, type Ref } from 'vue';
import {
  createModelPreviewController,
  type ModelPreviewControllerOptions,
  type ModelPreviewControls,
  type ModelPreviewState,
  type ModelViewer,
  type ModelViewerEvent,
  type ModelReadyInfo
} from '@chestnutlabs/gcode-model-renderer';
import type { CaptureOptions } from '@chestnutlabs/gcode-renderer-three';

export type { ModelPreviewControls, ModelPreviewState, ModelViewerEvent, ModelReadyInfo };
/** Vue-facing options — identical to the controller's (the alias is the public name). */
export type UseModelViewerOptions = ModelPreviewControllerOptions;

export interface ModelViewerHandle {
  /** Bind to a <canvas> template ref; rebinding disposes and rebuilds safely. */
  canvasRef: Ref<HTMLCanvasElement | null>;
  setSource: ModelPreviewControls['setSource'];
  capture(opts?: CaptureOptions): Promise<Blob>;
  state: Readonly<ModelPreviewState>;
  controls: ModelPreviewControls;
  raw: { viewer: () => ModelViewer | null };
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  dispose(): void;
}

export function useModelViewer(options: UseModelViewerOptions = {}): ModelViewerHandle {
  const controller = createModelPreviewController(options);

  const state = shallowReactive<ModelPreviewState>({ ...controller.getState() });
  const offState = controller.onStateChange((snap) => {
    Object.assign(state, snap);
  });

  const canvasRef = ref<HTMLCanvasElement | null>(null);
  watch(canvasRef, (canvas) => controller.bindCanvas(canvas));

  function dispose(): void {
    offState();
    controller.dispose();
  }
  if (getCurrentScope() !== undefined) onScopeDispose(dispose);

  return {
    canvasRef,
    setSource: controller.controls.setSource,
    capture: controller.controls.capture,
    state: readonly(state) as Readonly<ModelPreviewState>,
    controls: controller.controls,
    raw: controller.raw,
    onEvent: controller.onEvent,
    dispose
  };
}
