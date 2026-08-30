/**
 * useGcodePreview — the Vue reactivity bridge over the framework-neutral controller
 * (DD-007 §4.6, refactored in phase 5/issue #112; original glue extracted to
 * @chestnutlabs/gcode-preview-core). This file owns ONLY the Vue-isms: a canvas
 * template ref, a shallow-reactive state mirror fed by controller snapshots, and
 * scope-tied disposal. The engine mechanics, state model, and TypeScript contracts
 * live in the core package and are RE-EXPORTED, never redeclared (the D1-amendment
 * drift firewall). Public API is unchanged from phase 1.
 */
import { getCurrentScope, onScopeDispose, readonly, ref, shallowReactive, watch, type Ref } from 'vue';
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

/** Vue-facing options — identical to the controller's (the alias is the public name). */
export type UseGcodePreviewOptions = PreviewControllerOptions;

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
  /** Capture the current view as an image `Blob` (DD-030 D1, DD-031 G5) — handle-level parity with the
   *  Web Component's `capture()`. Also reachable as `controls.capture`. Rejects on the 2D renderer. */
  capture(opts?: CaptureOptions): Promise<Blob>;
  state: Readonly<GcodePreviewState>;
  controls: GcodePreviewControls;
  /** Escape hatches — the neutral objects themselves (advanced use; not reactive). */
  raw: { session: GcodeParseSession; renderer: () => PreviewRenderer | null };
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  dispose(): void;
}

export function useGcodePreview(options: UseGcodePreviewOptions = {}): GcodePreviewHandle {
  const controller = createPreviewController(options);

  // Reactivity bridge: controller snapshots → a shallow-reactive mirror. Snapshots
  // carry summaries only, so a shallow field copy is the whole bridge (§4.2 boundary).
  const state = shallowReactive<GcodePreviewState>({ ...controller.getState() });
  const offState = controller.onStateChange((snap) => {
    Object.assign(state, snap);
  });

  const canvasRef = ref<HTMLCanvasElement | null>(null);
  watch(canvasRef, (canvas) => controller.bindCanvas(canvas));

  function dispose(): void {
    offState();
    controller.dispose();
  }
  // Unmount/HMR safety (§4.2): auto-dispose with the owning effect scope, when there is one.
  if (getCurrentScope() !== undefined) onScopeDispose(dispose);

  return {
    canvasRef,
    parse: controller.parse,
    cancel: controller.cancel,
    observeProgress: controller.observeProgress,
    tickProgress: controller.tickProgress,
    clearProgress: controller.clearProgress,
    capture: controller.controls.capture,
    state: readonly(state) as Readonly<GcodePreviewState>,
    controls: controller.controls,
    raw: controller.raw,
    onEvent: controller.onEvent,
    dispose
  };
}
