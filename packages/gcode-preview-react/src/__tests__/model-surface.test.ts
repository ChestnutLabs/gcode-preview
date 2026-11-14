/**
 * Guard: `<ModelViewer>`'s props match the neutral `/model` surface every adapter shares
 * (`MODEL_VIEWER_PROP_KEYS` / `MODEL_VIEWER_EVENT_KEYS`). The props are read from the `ModelViewerProps`
 * interface itself (tests are not type-checked, so a type-level list would prove nothing): a prop added here
 * and not to the other adapters, or the other way round, fails CI.
 */
import { describe, expect, it } from 'vitest';
import { modelViewerSurfaceGaps } from '@chestnutlabs/gcode-model-renderer/testing';
import src from '../model/model-viewer-component.ts?raw';

function interfaceKeys(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name}`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^ {2}([A-Za-z]\w*)\??:/gm)].map((m) => m[1]!);
}

describe('react <ModelViewer>: the /model surface', () => {
  it('ModelViewerProps declares every shared prop and event, and nothing only React has', () => {
    const keys = interfaceKeys(src, 'ModelViewerProps');
    expect(keys.length).toBeGreaterThan(0);
    const isEvent = (k: string) => /^on[A-Z]/.test(k);
    expect(
      modelViewerSurfaceGaps({
        props: keys.filter((k) => !isEvent(k)),
        events: keys.filter(isEvent),
        eventNames: {
          ready: 'onReady',
          cameraChange: 'onCameraChange',
          error: 'onError',
          rendererUnsupported: 'onRendererUnsupported',
          contextLost: 'onContextLost',
          contextRestored: 'onContextRestored',
          progress: 'onProgress'
        }
      })
    ).toBe('');
  });
});
