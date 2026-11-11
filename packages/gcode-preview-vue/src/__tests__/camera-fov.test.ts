// @vitest-environment happy-dom
/** DD-032: the declarative `cameraFov` prop (construction option + change-only watcher; unset keeps the lens). */
import { describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, ref } from 'vue';
import { GcodePreview, type GcodePreviewHandle } from '../index';
import { StubWorker, makeStubGL, settle } from './helpers';

function mount(initial: number | undefined) {
  const { gl } = makeStubGL();
  const fov = ref<number | undefined>(initial);
  let exposed: unknown = null;
  const Parent = defineComponent({
    setup() {
      return () =>
        h(GcodePreview, {
          ref: (i) => {
            exposed = i;
          },
          cameraFov: fov.value,
          quality: 'lines',
          createWorker: () => new StubWorker(),
          rendererOptions: { createRenderer: () => gl, scheduleFrame: (cb: () => void) => cb(), chunksPerTick: 8 }
        });
    }
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Parent);
  app.mount(container);
  const lens = (): number =>
    ((exposed as { preview: GcodePreviewHandle }).preview.raw.renderer() as unknown as { cameraFov: number }).cameraFov;
  return {
    fov,
    lens,
    unmount: () => {
      app.unmount();
      container.remove();
    }
  };
}

describe('<GcodePreview> cameraFov (vue)', () => {
  it('applies the mount value, follows changes, and keeps the lens when unset', async () => {
    const m = mount(32);
    await settle();
    expect(m.lens()).toBe(32);
    m.fov.value = 40;
    await settle();
    expect(m.lens()).toBe(40);
    m.fov.value = undefined;
    await settle();
    expect(m.lens()).toBe(40);
    m.unmount();
  });

  it('defaults to 50 when never set', async () => {
    const m = mount(undefined);
    await settle();
    expect(m.lens()).toBe(50);
    m.unmount();
  });
});
