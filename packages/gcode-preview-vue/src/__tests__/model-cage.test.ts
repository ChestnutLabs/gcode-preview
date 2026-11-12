// @vitest-environment happy-dom
/** #490 through the VUE `/model` adapter: the `showVolumeCage` prop (default true) reaches the scene. */
import { describe, expect, it } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { ModelViewer, useModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  await nextTick();
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function mount(props: { showVolumeCage?: boolean }) {
  const gl = makeModelRecordingGL();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () =>
      h(ModelViewer, {
        source: makeStlModelSource(),
        buildVolume: { x: 100, y: 100, z: 100 },
        ...props,
        createRenderer: gl.createRenderer,
        createControls: MODEL_STUB_CONTROLS
      })
  });
  app.mount(host);
  return {
    gl,
    done: () => {
      app.unmount();
      host.remove();
    }
  };
}

describe('vue <ModelViewer> — showVolumeCage', () => {
  it('omitted draws the cage', async () => {
    const m = mount({});
    await settle();
    expect(m.gl.snapshot()).toMatchObject({ plate: true, cage: true });
    m.done();
  });

  it('false at mount hides the cage, and a change re-applies', async () => {
    const props = reactive<{ showVolumeCage?: boolean }>({ showVolumeCage: false });
    const m = mount(props);
    await settle();
    expect(m.gl.snapshot()).toMatchObject({ plate: true, cage: false });
    props.showVolumeCage = true;
    await settle();
    expect(m.gl.snapshot().cage).toBe(true);
    props.showVolumeCage = false;
    await settle();
    expect(m.gl.snapshot().cage).toBe(false);
    m.done();
  });

  it('useModelViewer takes the showVolumeCage option and exposes setBuildVolumeCage', async () => {
    const gl = makeModelRecordingGL();
    const viewer = useModelViewer({
      createRenderer: gl.createRenderer,
      createControls: MODEL_STUB_CONTROLS,
      buildVolume: { x: 100, y: 100, z: 100 },
      showVolumeCage: false
    });
    viewer.canvasRef.value = document.createElement('canvas');
    await settle();
    await viewer.setSource(makeStlModelSource());
    expect(gl.snapshot().cage).toBe(false);
    viewer.controls.setBuildVolumeCage(true);
    expect(gl.snapshot().cage).toBe(true);
    viewer.dispose();
  });
});
