/**
 * `useModelViewer` — the React hook for interactive **source-model** viewing (the Prepare side),
 * the analogue of `useGcodePreview` for the toolpath/Preview side (DD-031). A thin reactivity bridge
 * over the framework-neutral `createModelPreviewController` from `@chestnutlabs/gcode-model-renderer`
 * — never a separate viewer implementation (the D1 drift firewall). Shared contracts are re-exported
 * from the controller.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createModelPreviewController,
  type ModelPreviewController,
  type ModelPreviewControllerOptions,
  type ModelPreviewControls,
  type ModelPreviewState,
  type ModelViewer,
  type ModelViewerEvent,
  type ModelReadyInfo
} from '@chestnutlabs/gcode-model-renderer';
import type { CaptureOptions } from '@chestnutlabs/gcode-renderer-three';

export type { ModelPreviewControls, ModelPreviewState, ModelViewerEvent, ModelReadyInfo };
export type UseModelViewerOptions = ModelPreviewControllerOptions;

export interface ModelViewerHandle {
  /** Attach as `<canvas ref={viewer.canvasRef} />`; null detaches safely. */
  canvasRef: (el: HTMLCanvasElement | null) => void;
  /** Parse → build → frame → `ready`. Also reachable as `controls.setSource`. */
  setSource: ModelPreviewControls['setSource'];
  /** Capture the current view as an image `Blob` (also `controls.capture`). */
  capture(opts?: CaptureOptions): Promise<Blob>;
  /** Render-subscribed state snapshot (via useSyncExternalStore). */
  state: ModelPreviewState;
  controls: ModelPreviewControls;
  raw: { viewer: () => ModelViewer | null };
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  dispose(): void;
}

interface Slot {
  controller: ModelPreviewController | null;
  disposed: boolean;
  canvas: HTMLCanvasElement | null;
}

export function useModelViewer(options: UseModelViewerOptions = {}): ModelViewerHandle {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const slot = useRef<Slot>({ controller: null, disposed: false, canvas: null });

  const ensure = useCallback((): ModelPreviewController => {
    const s = slot.current;
    if (s.controller === null || s.disposed) {
      s.controller = createModelPreviewController(optionsRef.current);
      s.disposed = false;
      if (s.canvas !== null) s.controller.bindCanvas(s.canvas);
    }
    return s.controller;
  }, []);

  const subscribe = useCallback((cb: () => void) => ensure().onStateChange(() => cb()), [ensure]);
  const getSnapshot = useCallback(() => ensure().getState(), [ensure]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Own the controller's lifecycle: (re)create on mount (StrictMode's second setup lands here) and
  // DISPOSE on unmount. Without this the GL engine was freed via the canvas-ref-null path but the
  // controller was never disposed, so in-flight setSource promises never settled and the controller
  // leaked — the toolpath hook already does this; the model hook must match.
  useEffect(() => {
    const c = ensure();
    // Refs attach BEFORE StrictMode's dispose/recreate cycle: rebind the delivered canvas to the fresh
    // controller (refs never re-fire) so it renders again after a remount.
    if (slot.current.canvas !== null && c.raw.viewer() === null) {
      c.bindCanvas(slot.current.canvas);
    }
    return () => {
      slot.current.controller?.dispose();
      slot.current.disposed = true;
    };
  }, [ensure]);

  const stateRef = useRef(state);
  stateRef.current = state;

  return useMemo<ModelViewerHandle>(
    () => ({
      canvasRef: (el) => {
        slot.current.canvas = el;
        ensure().bindCanvas(el);
      },
      setSource: (input) => ensure().controls.setSource(input),
      capture: (opts) => ensure().controls.capture(opts),
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
