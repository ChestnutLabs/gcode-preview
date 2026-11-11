// @vitest-environment happy-dom
/** The declarative `pixelRatio` prop on `<GcodePreview>` and the `/model` `<ModelViewer>` (vue). */
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, ref } from 'vue';
import { MODEL_STUB_CONTROLS, makeStlModelSource } from '@chestnutlabs/gcode-model-renderer/testing';
import type { GLRendererLike, PixelRatioOption, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreview } from '../index';
import { ModelViewer } from '../model/index';
import { StubWorker, makeStubGL, settle } from './helpers';

/** A stub GL that records every ratio handed to it. */
function ratioGL(canvas: RenderTargetCanvas, ratios: number[] = []): { gl: GLRendererLike; ratios: number[] } {
  const gl: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    setPixelRatio: (r) => ratios.push(r),
    dispose: () => undefined,
    domElement: canvas
  };
  return { gl, ratios };
}

function mountApp(render: () => ReturnType<typeof h>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(defineComponent({ setup: () => render }));
  app.mount(container);
  return () => {
    app.unmount();
    container.remove();
  };
}

describe('<GcodePreview> pixelRatio (vue)', () => {
  it('applies the mount value, follows changes, and keeps the ratio when unset', async () => {
    const { gl: base } = makeStubGL();
    const { gl, ratios } = ratioGL(base.domElement);
    const ratio = ref<PixelRatioOption | undefined>(2);
    const unmount = mountApp(() =>
      h(GcodePreview, {
        pixelRatio: ratio.value,
        quality: 'lines',
        createWorker: () => new StubWorker(),
        rendererOptions: { createRenderer: () => gl, scheduleFrame: (cb: () => void) => cb(), chunksPerTick: 8 }
      })
    );
    await settle();
    expect(ratios).toEqual([2]);
    ratio.value = 1.5;
    await settle();
    expect(ratios).toEqual([2, 1.5]);
    ratio.value = undefined;
    await settle();
    expect(ratios).toEqual([2, 1.5]);
    unmount();
  });
});

describe('vue <ModelViewer> pixelRatio', () => {
  it('applies the mount value and follows changes', async () => {
    const ratios: number[] = [];
    const ratio = ref<PixelRatioOption | undefined>(3);
    const unmount = mountApp(() =>
      h(ModelViewer, {
        source: makeStlModelSource(),
        pixelRatio: ratio.value,
        createRenderer: (c: RenderTargetCanvas) => ratioGL(c, ratios).gl,
        createControls: MODEL_STUB_CONTROLS
      })
    );
    await settle();
    expect(ratios).toEqual([3]);
    ratio.value = 0.5;
    await settle();
    expect(ratios).toEqual([3, 0.5]);
    unmount();
  });
});
