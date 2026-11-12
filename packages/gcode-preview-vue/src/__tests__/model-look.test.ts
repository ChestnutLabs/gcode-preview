// @vitest-environment happy-dom
/**
 * DD-032 through the VUE `/model` adapter: the declarative `buildVolume` / `theme` / `cameraFov` props reach
 * the scene (plate, shadow, gradient, lens) and `state.placement` / `placementOffset`, and re-apply on change.
 */
import { describe, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive, ref } from 'vue';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { studioTheme, type BuildVolumeDef, type Theme } from '@chestnutlabs/gcode-renderer-three';
import { ModelViewer, useModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  await nextTick();
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('vue <ModelViewer> — DD-032 look props', () => {
  it('buildVolume / theme / cameraFov props reach the scene and state, and re-apply when changed', async () => {
    const gl = makeModelRecordingGL();
    const props = reactive<{ buildVolume?: BuildVolumeDef | null; theme?: Theme; cameraFov?: number }>({
      buildVolume: { x: 100, y: 100, z: 100 },
      theme: studioTheme('dark'),
      cameraFov: 32
    });
    const comp = ref<{ viewer: ReturnType<typeof useModelViewer> } | null>(null);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp({
      render: () =>
        h(ModelViewer, {
          ref: comp,
          source: makeStlModelSource(),
          ...props,
          createRenderer: gl.createRenderer,
          createControls: MODEL_STUB_CONTROLS
        })
    });
    app.mount(host);
    await settle();

    const viewer = comp.value!.viewer;
    expect(viewer.state.placement).toBe('approximated');
    expect(viewer.state.placementOffset).toEqual({ x: 45, y: 40, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 32, plate: true, cage: true, shadow: true, background: 'DataTexture' });

    props.buildVolume = { x: 200, y: 200, z: 100 };
    props.cameraFov = 60;
    props.theme = { ...studioTheme('light'), background: null };
    await settle();
    expect(viewer.state.placementOffset).toEqual({ x: 95, y: 90, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 60, plate: true, cage: true, shadow: true, background: 'null' });

    props.buildVolume = null;
    await settle();
    expect(viewer.state.placement).toBeNull();
    expect(gl.snapshot().plate).toBe(false);
    app.unmount();
    host.remove();
  });

  it('useModelViewer takes the same options and exposes the imperative setters', async () => {
    const gl = makeModelRecordingGL();
    const viewer = useModelViewer({
      createRenderer: gl.createRenderer,
      createControls: MODEL_STUB_CONTROLS,
      buildVolume: { x: 100, y: 100, z: 100 },
      theme: studioTheme('dark'),
      cameraFov: 32
    });
    viewer.canvasRef.value = document.createElement('canvas');
    await settle();
    await viewer.setSource(makeStlModelSource());
    expect(gl.snapshot()).toMatchObject({ fov: 32, plate: true });
    viewer.controls.setCameraFov(45);
    expect(gl.snapshot().fov).toBe(45);
    expect(() => viewer.controls.setCameraFov(5)).toThrow(RangeError);
    viewer.dispose();
  });
});
