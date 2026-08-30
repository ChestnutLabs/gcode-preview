// @vitest-environment happy-dom
/**
 * The framework-portable MODEL behavioral suite through the CUSTOM-ELEMENT adapter (DD-031): the same
 * source → state → controls → dispose parity contract every model adapter passes, proving
 * `<gcode-model-viewer>` is a faithful shell over the shared model controller. connectedCallback binds
 * synchronously, so the harness is a plain sync create() with a microtask settle.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_STUB_GL,
  MODEL_STUB_CONTROLS,
  runModelBehavioralSuite,
  type ModelAdapterInstance
} from '@chestnutlabs/gcode-model-renderer/testing';
import { GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

runModelBehavioralSuite(
  'gcode-model-viewer custom element',
  { describe, it, expect },
  {
    create() {
      defineGcodeModelViewer();
      const el = document.createElement('gcode-model-viewer') as GcodeModelViewerElement;
      // Injectables the suite needs are JS properties (they can't be HTML attributes).
      el.createRenderer = MODEL_STUB_GL;
      el.createControls = MODEL_STUB_CONTROLS;
      document.body.appendChild(el); // connectedCallback creates the controller + binds synchronously

      const instance: ModelAdapterInstance = {
        controls: el.controls,
        getState: () => el.state,
        onEvent: (cb) => el.onEvent(cb),
        dispose: () => el.remove(),
        settle
      };
      return instance;
    }
  }
);
