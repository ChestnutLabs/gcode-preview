/**
 * createGcodePreview — the Svelte reactivity bridge over the framework-neutral
 * controller (DD-007 §4.6 D1 amendment, phase 7, issue #114). This file owns ONLY the
 * Svelte-isms: a store-contract `state` (subscribe receiving controller snapshots) and
 * a `use:` action for the canvas. Engine mechanics and contracts live in
 * @chestnutlabs/gcode-preview-core and are RE-EXPORTED, never redeclared.
 *
 * Lifecycle: the component wrapper disposes via onDestroy. Headless users (this API
 * outside a component) call `dispose()` themselves — there is no ambient scope to tie to.
 */
import type { GcodeParseSession, WireParseOptions } from '@chestnutlabs/gcode-parser';
import type { MappedProgress, ProgressObservation } from '@chestnutlabs/toolpath-core';
import {
  createPreviewController,
  type CaptureOptions,
  type GcodePreviewControls,
  type GcodePreviewState,
  type ParseOutcome,
  type PreviewControllerOptions,
  type PreviewEvent,
  type PreviewRenderer
} from '@chestnutlabs/gcode-preview-core';

// Shared contracts pass through unchanged (D1 amendment: re-export, never redeclare).
export type {
  GcodePreviewControls,
  GcodePreviewState,
  ParseOutcome,
  PreviewEvent,
  PreviewRenderer,
  RendererMode
} from '@chestnutlabs/gcode-preview-core';

/** Svelte-facing options — identical to the controller's (the alias is the public name). */
export type CreateGcodePreviewOptions = PreviewControllerOptions;

/** Minimal svelte/store Readable contract — declared structurally so the shipped JS
 *  never imports 'svelte' (the component and consumers bring their own). */
export interface ReadableState {
  subscribe(run: (state: GcodePreviewState) => void): () => void;
}

/** Svelte `use:` action result for the canvas binding. */
export interface CanvasActionResult {
  destroy(): void;
}

export interface SvelteGcodePreview {
  /** Store-contract state: subscribers receive the current snapshot immediately,
   *  then every replacement — `$preview.state` works in components. */
  state: ReadableState;
  /** Canvas binding as a Svelte action: `<canvas use:preview.canvas />`. */
  canvas(el: HTMLCanvasElement): CanvasActionResult;
  parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome>;
  cancel(): void;
  observeProgress(obs: ProgressObservation): MappedProgress | null;
  tickProgress(nowMs: number): MappedProgress | null;
  clearProgress(): void;
  /** Capture the current view as an image `Blob` (DD-030 D1, DD-031 G5) — handle-level parity with the
   *  Web Component's `capture()`. Also reachable as `controls.capture`. Rejects on the 2D renderer. */
  capture(opts?: CaptureOptions): Promise<Blob>;
  controls: GcodePreviewControls;
  raw: { session: GcodeParseSession; renderer: () => PreviewRenderer | null };
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  dispose(): void;
}

export function createGcodePreview(options: CreateGcodePreviewOptions = {}): SvelteGcodePreview {
  const controller = createPreviewController(options);
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
    parse: controller.parse,
    cancel: controller.cancel,
    observeProgress: controller.observeProgress,
    tickProgress: controller.tickProgress,
    clearProgress: controller.clearProgress,
    capture: controller.controls.capture,
    controls: controller.controls,
    raw: controller.raw,
    onEvent: controller.onEvent,
    dispose: controller.dispose
  };
}
