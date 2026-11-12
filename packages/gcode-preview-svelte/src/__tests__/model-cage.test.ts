// @vitest-environment happy-dom
/**
 * #490 through the SVELTE `/model` adapter's compiler-free surface (`createModelViewer`): the
 * `showVolumeCage` option and `controls.setBuildVolumeCage`. The `.svelte` shell's reactive statement is not
 * compiled in this suite (no Svelte compiler here), the same limit as the existing model suites.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { createModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('svelte createModelViewer — showVolumeCage', () => {
  it('the option hides the cage and the setter re-applies', async () => {
    const gl = makeModelRecordingGL();
    const viewer = createModelViewer({
      createRenderer: gl.createRenderer,
      createControls: MODEL_STUB_CONTROLS,
      buildVolume: { x: 100, y: 100, z: 100 },
      showVolumeCage: false
    });
    const action = viewer.canvas(document.createElement('canvas'));
    await settle();
    await viewer.setSource(makeStlModelSource());
    expect(gl.snapshot()).toMatchObject({ plate: true, cage: false });
    viewer.controls.setBuildVolumeCage(true);
    expect(gl.snapshot().cage).toBe(true);
    action.destroy();
    viewer.dispose();
  });
});
