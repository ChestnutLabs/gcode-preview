// @vitest-environment happy-dom
/**
 * The framework-portable MODEL behavioral suite through the REACT adapter (DD-031): the same
 * source → state → controls → dispose parity contract every model adapter passes, proving
 * `useModelViewer` / `<ModelViewer>` is a faithful bridge over the shared model controller.
 */
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MODEL_STUB_GL,
  MODEL_STUB_CONTROLS,
  runModelBehavioralSuite,
  type ModelAdapterInstance
} from '@chestnutlabs/gcode-model-renderer/testing';
import { useModelViewer, type ModelViewerHandle, type UseModelViewerOptions } from '../model/index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: { options: UseModelViewerOptions; grab: (h: ModelViewerHandle) => void }) {
  const viewer = useModelViewer(props.options);
  props.grab(viewer);
  return createElement('canvas', { ref: viewer.canvasRef });
}

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

runModelBehavioralSuite(
  'react useModelViewer',
  { describe, it, expect },
  {
    async create() {
      let handle: ModelViewerHandle | null = null;
      const latest = (): ModelViewerHandle => handle as ModelViewerHandle;
      const options: UseModelViewerOptions = {
        createRenderer: MODEL_STUB_GL,
        createControls: MODEL_STUB_CONTROLS
      };
      const host = document.createElement('div');
      document.body.appendChild(host);
      let root: Root | null = null;
      await act(async () => {
        root = createRoot(host);
        root.render(createElement(Probe, { options, grab: (h) => (handle = h) }));
      });
      const instance: ModelAdapterInstance = {
        get controls() {
          return latest().controls;
        },
        getState: () => latest().state,
        onEvent: (cb) => latest().onEvent(cb),
        dispose: async () => {
          await act(async () => {
            root?.unmount();
          });
          host.remove();
        },
        settle
      };
      return instance;
    }
  }
);
