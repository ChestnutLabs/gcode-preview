// @vitest-environment happy-dom
/**
 * The framework-portable MODEL behavioral suite through the VUE adapter (DD-031): the same
 * source → state → controls → dispose parity contract every model adapter passes, proving
 * `useModelViewer` / `<ModelViewer>` is a faithful bridge over the shared model controller.
 */
import { describe, expect, it } from 'vitest';
import { effectScope, nextTick } from 'vue';
import {
  MODEL_STUB_GL,
  MODEL_STUB_CONTROLS,
  runModelBehavioralSuite,
  type ModelAdapterInstance
} from '@chestnutlabs/gcode-model-renderer/testing';
import { useModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  await nextTick();
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

runModelBehavioralSuite(
  'vue useModelViewer',
  { describe, it, expect },
  {
    async create() {
      const canvas = document.createElement('canvas');
      const scope = effectScope();
      const viewer = scope.run(() =>
        useModelViewer({ createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS })
      )!;
      viewer.canvasRef.value = canvas;
      await nextTick();
      const instance: ModelAdapterInstance = {
        controls: viewer.controls,
        getState: () => viewer.state,
        onEvent: (cb) => viewer.onEvent(cb),
        dispose: () => {
          scope.stop();
        },
        settle
      };
      return instance;
    }
  }
);
