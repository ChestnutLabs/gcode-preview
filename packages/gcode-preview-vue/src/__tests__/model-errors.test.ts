// @vitest-environment happy-dom
/**
 * How a bad prop / an unbound capture surfaces to the consumer through the VUE `/model` adapter (pinned, not
 * changed): an invalid `renderScope` throws `RangeError` into Vue's `app.config.errorHandler` (at setup via the
 * construction check, later via the prop watcher), the same channel an invalid toolpath prop uses;
 * `capture()` before a canvas is bound rejects with `CaptureUnsupportedError`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, effectScope, h, nextTick, reactive } from 'vue';
import { MODEL_STUB_CONTROLS, MODEL_STUB_GL } from '@chestnutlabs/gcode-model-renderer/testing';
import { CaptureUnsupportedError } from '@chestnutlabs/gcode-renderer-three';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview } from '../index';
import { ModelViewer, useModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  await nextTick();
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};

const modelProps = { createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS };
const toolpathProps = {
  createWorker: () => new SuiteStubWorker(),
  rendererOptions: {
    createRenderer: (c: HTMLCanvasElement) => makeSuiteStubGL(c),
    scheduleFrame: (cb: () => void) => cb()
  }
};

/** Mount `component` with reactive props; return what Vue's errorHandler received after applying each patch. */
async function caught(component: unknown, first: Record<string, unknown>, then?: Record<string, unknown>) {
  const errors: unknown[] = [];
  const props = reactive<Record<string, unknown>>({ ...first });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(component as never, { ...props }) });
  app.config.errorHandler = (e) => {
    errors.push(e);
  };
  app.config.warnHandler = () => undefined;
  app.mount(host);
  await settle();
  if (then !== undefined) {
    Object.assign(props, then);
    await settle();
  }
  app.unmount();
  host.remove();
  return errors;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('vue <ModelViewer>: invalid input surfaces as a RangeError in the errorHandler', () => {
  it('a bad renderScope at mount (construction check) reaches app.config.errorHandler', async () => {
    const errors = await caught(ModelViewer, { ...modelProps, renderScope: { objectIds: 'nope' } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as Error).message).toContain('objectIds');
  });

  it('a bad renderScope set after mount (watcher) reaches app.config.errorHandler', async () => {
    const errors = await caught(
      ModelViewer,
      { ...modelProps, renderScope: { objectIds: ['a'] } },
      { renderScope: { plateId: 1.5 } }
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as Error).message).toContain('plateId');
  });

  it('is the same channel as the toolpath component: a NaN layerRange also reaches the errorHandler', async () => {
    const errors = await caught(
      GcodePreview,
      { ...toolpathProps, layerRange: [0, 1] },
      { layerRange: [Number.NaN, 1] }
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as Error).message).toContain('NaN');
  });
});

describe('vue <ModelViewer>: capture', () => {
  it('before a canvas is bound rejects with CaptureUnsupportedError through the handle and through controls', async () => {
    const scope = effectScope();
    const viewer = scope.run(() => useModelViewer(modelProps))!; // canvasRef never set
    await expect(viewer.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    await expect(viewer.controls.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    scope.stop();
  });

  it('with a renderer that cannot render to a target rejects the same way after bind', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let handle: { viewer: ReturnType<typeof useModelViewer> } | null = null;
    const app = createApp({
      render: () =>
        h(ModelViewer, {
          ...modelProps,
          ref: (r: unknown) => {
            handle = r as typeof handle;
          }
        })
    });
    app.mount(host);
    await settle();
    await expect(handle!.viewer.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    app.unmount();
    host.remove();
  });
});
