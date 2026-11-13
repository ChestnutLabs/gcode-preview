/**
 * Guard: Vue's `<ModelViewer>` props and emits match the neutral `/model` surface every adapter shares
 * (`MODEL_VIEWER_PROP_KEYS` / `MODEL_VIEWER_EVENT_KEYS`), read from the component definition itself.
 */
import { describe, expect, it } from 'vitest';
import { modelViewerSurfaceGaps } from '@chestnutlabs/gcode-model-renderer/testing';
import { ModelViewer } from '../model/index';

describe('vue <ModelViewer>: the /model surface', () => {
  it('declares every shared prop and emit, and nothing only Vue has', () => {
    const def = ModelViewer as unknown as { props: Record<string, unknown>; emits: Record<string, unknown> };
    expect(
      modelViewerSurfaceGaps({
        props: Object.keys(def.props),
        events: Object.keys(def.emits),
        eventNames: {
          ready: 'ready',
          cameraChange: 'camera-change',
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
