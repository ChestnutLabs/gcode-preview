// @vitest-environment happy-dom
/**
 * DD-032 through the SVELTE `/model` adapter's compiler-free surface (`createModelViewer`, which the
 * `.svelte` shell wraps one prop → one controls call): the `buildVolume` / `theme` / `cameraFov` options
 * reach the scene and state, and the imperative setters work. The `.svelte` prop statements themselves are
 * not compiled in this suite (no Svelte compiler here), the same limit as the existing model suite.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { studioTheme } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer, type ModelPreviewState } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('svelte createModelViewer — DD-032 look', () => {
  it('options reach the scene and state; setters re-apply; invalid lens throws synchronously', async () => {
    const gl = makeModelRecordingGL();
    const viewer = createModelViewer({
      createRenderer: gl.createRenderer,
      createControls: MODEL_STUB_CONTROLS,
      buildVolume: { x: 100, y: 100, z: 100 },
      theme: studioTheme('dark'),
      cameraFov: 32
    });
    let state!: ModelPreviewState;
    viewer.state.subscribe((s) => {
      state = s;
    });
    const action = viewer.canvas(document.createElement('canvas'));
    await settle();
    await viewer.setSource(makeStlModelSource());
    expect(state.placement).toBe('approximated');
    expect(state.placementOffset).toEqual({ x: 45, y: 40, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 32, plate: true, shadow: true, background: 'DataTexture' });

    viewer.controls.setBuildVolume({ x: 200, y: 200, z: 100 });
    viewer.controls.setCameraFov(60);
    viewer.controls.setTheme({ ...studioTheme('light'), background: null });
    expect(state.placementOffset).toEqual({ x: 95, y: 90, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 60, plate: true, shadow: true, background: 'null' });
    expect(() => viewer.controls.setCameraFov(121)).toThrow(RangeError);
    expect(() => viewer.controls.setTheme({ bedOutline: { opacity: 2 } })).toThrow(RangeError);
    viewer.controls.setBuildVolume(null);
    expect(state.placement).toBeNull();
    expect(gl.snapshot().plate).toBe(false);
    action.destroy();
    viewer.dispose();
  });
});
