/**
 * Guard: `ModelViewer.svelte` matches the neutral `/model` surface every adapter shares
 * (`MODEL_VIEWER_PROP_KEYS` / `MODEL_VIEWER_EVENT_KEYS`). A compiled Svelte component exposes no prop or event
 * list that holds for both Svelte 4 and 5, so this reads the component source: its `export let` props and the
 * event names it dispatches.
 */
import { describe, expect, it } from 'vitest';
import { modelViewerSurfaceGaps } from '@chestnutlabs/gcode-model-renderer/testing';
import src from '../model/ModelViewer.svelte?raw';

describe('svelte <ModelViewer>: the /model surface', () => {
  it('declares every shared prop and event, and nothing only Svelte has', () => {
    const props = [...src.matchAll(/^\s*export let ([A-Za-z]\w*)/gm)].map((m) => m[1]!);
    const events = [...src.matchAll(/dispatch\('([a-z-]+)'/g)].map((m) => m[1]!);
    expect(props.length).toBeGreaterThan(0);
    expect(
      modelViewerSurfaceGaps({
        props,
        events,
        eventNames: {
          ready: 'ready',
          cameraChange: 'camerachange',
          error: 'error',
          rendererUnsupported: 'rendererunsupported',
          contextLost: 'contextlost',
          contextRestored: 'contextrestored',
          progress: 'progress'
        }
      })
    ).toBe('');
  });
});
