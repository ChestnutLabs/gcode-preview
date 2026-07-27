/**
 * useGcodePreview — the React reactivity bridge over the framework-neutral controller
 * (DD-007 §4.6 D1 amendment, phase 6, issue #113). This file owns ONLY the React-isms:
 * a `useSyncExternalStore` subscription to controller snapshots, a callback canvas ref,
 * and effect-scoped disposal. Engine mechanics and contracts live in
 * @chestnutlabs/gcode-preview-core and are RE-EXPORTED, never redeclared.
 *
 * StrictMode safety: React 18 dev mounts effects twice (setup → cleanup → setup). Every
 * delegate goes through `ensure()`, which lazily (re)creates the controller after a
 * cleanup disposed it — the remounted subscription lands on the fresh controller.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { GcodeParseSession, WireParseOptions } from '@chestnutlabs/gcode-parser';
import type { MappedProgress, ProgressObservation } from '@chestnutlabs/toolpath-core';
import {
  createPreviewController,
  type GcodePreviewControls,
  type GcodePreviewState,
  type ParseOutcome,
  type PreviewController,
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

/** React-facing options — identical to the controller's (the alias is the public name). */
export type UseGcodePreviewOptions = PreviewControllerOptions;

export interface GcodePreviewHandle {
  /** Attach as `<canvas ref={preview.canvasRef} />`; null detaches safely. */
  canvasRef: (el: HTMLCanvasElement | null) => void;
  parse(input: Uint8Array | ArrayBuffer | File, opts?: WireParseOptions): Promise<ParseOutcome>;
  cancel(): void;
  observeProgress(obs: ProgressObservation): MappedProgress | null;
  tickProgress(nowMs: number): MappedProgress | null;
  clearProgress(): void;
  /** Current state snapshot — render-subscribed via useSyncExternalStore. */
  state: GcodePreviewState;
  controls: GcodePreviewControls;
  raw: { session: GcodeParseSession; renderer: () => PreviewRenderer | null };
  onEvent(cb: (e: PreviewEvent) => void): () => void;
  dispose(): void;
}

interface Slot {
  controller: PreviewController | null;
  disposed: boolean;
  /** Last canvas the ref delivered — StrictMode recreates the controller AFTER refs
   *  attached, so the mount effect must re-bind it to the fresh controller. */
  canvas: HTMLCanvasElement | null;
}

export function useGcodePreview(options: UseGcodePreviewOptions = {}): GcodePreviewHandle {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const slot = useRef<Slot>({ controller: null, disposed: false, canvas: null });

  const ensure = useCallback((): PreviewController => {
    const s = slot.current;
    if (s.controller === null || s.disposed) {
      s.controller = createPreviewController(optionsRef.current);
      s.disposed = false;
    }
    return s.controller;
  }, []);

  const subscribe = useCallback((cb: () => void) => ensure().onStateChange(() => cb()), [ensure]);
  const getSnapshot = useCallback(() => ensure().getState(), [ensure]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    const c = ensure(); // (re)create on mount — StrictMode's second setup lands here
    // Refs attached BEFORE StrictMode's dispose/recreate cycle: rebind the canvas the
    // ref delivered so the fresh controller actually renders (refs never re-fire).
    if (slot.current.canvas !== null && c.raw.renderer() === null) {
      c.bindCanvas(slot.current.canvas);
    }
    return () => {
      slot.current.controller?.dispose();
      slot.current.disposed = true;
    };
  }, [ensure]);

  // The handle (incl. canvasRef) must be IDENTITY-STABLE across state changes: a fresh
  // canvasRef each render would make React detach/reattach the ref, rebuilding the
  // renderer per snapshot — an infinite loop. `state` reads through a per-render ref.
  const stateRef = useRef(state);
  stateRef.current = state;
  return useMemo<GcodePreviewHandle>(
    () => ({
      canvasRef: (el) => {
        slot.current.canvas = el;
        if (el === null) slot.current.controller?.bindCanvas(null);
        else ensure().bindCanvas(el);
      },
      parse: (input, opts) => ensure().parse(input, opts),
      cancel: () => slot.current.controller?.cancel(),
      observeProgress: (obs) => slot.current.controller?.observeProgress(obs) ?? null,
      tickProgress: (nowMs) => slot.current.controller?.tickProgress(nowMs) ?? null,
      clearProgress: () => slot.current.controller?.clearProgress(),
      get state() {
        return stateRef.current;
      },
      get controls() {
        return ensure().controls;
      },
      get raw() {
        return ensure().raw;
      },
      onEvent: (cb) => ensure().onEvent(cb),
      dispose: () => {
        slot.current.controller?.dispose();
        slot.current.disposed = true;
      }
    }),
    [ensure]
  );
}
