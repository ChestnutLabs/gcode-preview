// @vitest-environment happy-dom
/**
 * Guard: `<gcode-model-viewer>` matches the neutral `/model` surface every adapter shares
 * (`MODEL_VIEWER_PROP_KEYS` / `MODEL_VIEWER_EVENT_KEYS`). Its props are the settable accessors on the element
 * class; its event names are the ones the element source dispatches.
 */
import { describe, expect, it } from 'vitest';
import { modelViewerSurfaceGaps } from '@chestnutlabs/gcode-model-renderer/testing';
import { GcodeModelViewerElement } from '../model/index';
import src from '../model/gcode-model-viewer-element.ts?raw';

describe('element <gcode-model-viewer>: the /model surface', () => {
  it('has every shared property and event, and nothing only the element has', () => {
    const descriptors = Object.getOwnPropertyDescriptors(GcodeModelViewerElement.prototype);
    const props = Object.entries(descriptors)
      .filter(([, d]) => typeof d.get === 'function' && typeof d.set === 'function')
      .map(([k]) => k);
    const events = [...src.matchAll(/(?:emit\(|new CustomEvent\()'([a-z-]+)'/g)].map((m) => m[1]!);
    expect(
      modelViewerSurfaceGaps({
        props,
        events,
        eventNames: {
          ready: 'ready',
          cameraChange: 'camerachange',
          error: 'error',
          rendererUnsupported: 'renderer-unsupported',
          contextLost: 'context-lost',
          contextRestored: 'context-restored',
          progress: 'progress'
        }
      })
    ).toBe('');
  });
});
