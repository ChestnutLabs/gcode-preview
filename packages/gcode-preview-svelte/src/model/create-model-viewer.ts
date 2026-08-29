/**
 * createModelViewer — the Svelte reactivity bridge for interactive **source-model** viewing (the
 * Prepare side), the analogue of `createGcodePreview` for the toolpath/Preview side (DD-031). Owns
 * only the Svelte-isms: a store-contract `state` (subscribe receiving controller snapshots) and a
 * `use:` action for the canvas. Engine/state/contracts live in `@chestnutlabs/gcode-model-renderer`
 * and are re-exported, never redeclared (the D1 drift firewall).
 *
 * Named `createModelViewer` to parallel `createGcodePreview`; the underlying engine factory of the same
 * name is imported here under an alias.
 */
import {
  createModelPreviewController,
  type ModelPreviewControllerOptions,
  type ModelPreviewControls,
  type ModelPreviewState,
  type ModelViewer as ModelViewerEngine,
  type ModelViewerEvent,
  type ModelReadyInfo
} from '@chestnutlabs/gcode-model-renderer';
import type { CaptureOptions } from '@chestnutlabs/gcode-renderer-three';

export type { ModelPreviewControls, ModelPreviewState, ModelViewerEvent, ModelReadyInfo };
/** Svelte-facing options — identical to the controller's (the alias is the public name). */
export type CreateModelViewerOptions = ModelPreviewControllerOptions;

/** Minimal svelte/store Readable contract — declared structurally so the shipped JS never imports 'svelte'. */
export interface ReadableModelState {
  subscribe(run: (state: ModelPreviewState) => void): () => void;
}

export interface CanvasActionResult {
  destroy(): void;
}

export interface SvelteModelViewer {
  /** Store-contract state: subscribers get the current snapshot immediately, then every replacement. */
  state: ReadableModelState;
  /** Canvas binding as a Svelte action: `<canvas use:viewer.canvas />`. */
  canvas(el: HTMLCanvasElement): CanvasActionResult;
  setSource: ModelPreviewControls['setSource'];
  capture(opts?: CaptureOptions): Promise<Blob>;
  controls: ModelPreviewControls;
  raw: { viewer: () => ModelViewerEngine | null };
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  dispose(): void;
}

export function createModelViewer(options: CreateModelViewerOptions = {}): SvelteModelViewer {
  const controller = createModelPreviewController(options);
  return {
    state: {
      subscribe(run) {
        run(controller.getState()); // store contract: immediate emission
        return controller.onStateChange(run);
      }
    },
    canvas: (el) => {
      controller.bindCanvas(el);
      return { destroy: () => controller.bindCanvas(null) };
    },
    setSource: controller.controls.setSource,
    capture: controller.controls.capture,
    controls: controller.controls,
    raw: controller.raw,
    onEvent: controller.onEvent,
    dispose: controller.dispose
  };
}
