// @vitest-environment happy-dom
/**
 * The framework-portable MODEL behavioral suite through the SVELTE adapter (DD-031): the same
 * source → state → controls → dispose parity contract every model adapter passes, proving the
 * store/action API is a faithful bridge over the shared model controller. Compiler-free — the store
 * contract and `use:` action are plain functions.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_STUB_GL,
  MODEL_STUB_CONTROLS,
  runModelBehavioralSuite,
  type ModelAdapterInstance
} from '@chestnutlabs/gcode-model-renderer/testing';
import { createModelViewer, type SvelteModelViewer, type ModelPreviewState } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Read the current store value the Svelte way (subscribe → capture → unsubscribe). */
function current(viewer: SvelteModelViewer): ModelPreviewState {
  let value!: ModelPreviewState;
  const off = viewer.state.subscribe((s) => {
    value = s;
  });
  off();
  return value;
}

runModelBehavioralSuite(
  'svelte createModelViewer',
  { describe, it, expect },
  {
    create() {
      const canvas = document.createElement('canvas');
      const viewer = createModelViewer({ createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS });
      const action = viewer.canvas(canvas); // `use:viewer.canvas`
      const instance: ModelAdapterInstance = {
        controls: viewer.controls,
        getState: () => current(viewer),
        onEvent: (cb) => viewer.onEvent(cb),
        dispose: () => {
          action.destroy();
          viewer.dispose();
        },
        settle
      };
      return instance;
    }
  }
);
