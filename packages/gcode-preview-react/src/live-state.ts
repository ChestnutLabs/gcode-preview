/**
 * Package-internal side channel (#430): the controller's LIVE state for a hook handle.
 *
 * `GcodePreviewHandle.state` is the render snapshot (useSyncExternalStore), which lags React's commit —
 * read inside a controller event handler it is still the PREVIOUS snapshot. Event-driven callbacks that
 * report state (e.g. `<GcodePreview onDisclosure>`) must read the controller instead, the way the Vue,
 * Svelte, and Web Component adapters do. Deliberately NOT re-exported from the package index: it adds no
 * public API, only a lookup the component uses.
 */
import type { GcodePreviewState } from '@chestnutlabs/gcode-preview-core';

const liveState = new WeakMap<object, () => GcodePreviewState>();

/** Register `read` as the live-state reader for `handle` (called once per handle by the hook). */
export function registerLiveState(handle: object, read: () => GcodePreviewState): void {
  liveState.set(handle, read);
}

/**
 * The controller's current state for a handle `useGcodePreview` returned. Throws for any other object:
 * falling back to the render snapshot would silently bring back the stale read this module exists to avoid.
 */
export function readLiveState(handle: object): GcodePreviewState {
  const read = liveState.get(handle);
  if (read === undefined) throw new Error('readLiveState: not a useGcodePreview handle');
  return read();
}
