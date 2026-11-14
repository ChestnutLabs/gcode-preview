// @vitest-environment happy-dom
/**
 * How a bad prop / an unbound capture surfaces to the consumer through the REACT `/model` adapter (pinned, not
 * changed): an invalid `renderScope` throws `RangeError` into the React tree (an error boundary catches it, at
 * mount via the construction check and later via the effect), exactly like an invalid toolpath prop does;
 * `capture()` before a canvas is bound rejects with `CaptureUnsupportedError`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MODEL_STUB_CONTROLS, MODEL_STUB_GL } from '@chestnutlabs/gcode-model-renderer/testing';
import { CaptureUnsupportedError } from '@chestnutlabs/gcode-renderer-three';
import { renderCaught } from './error-surface';
import { ModelViewer, useModelViewer, type ModelViewerHandle } from '../model/index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

const modelProps = { createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS };
afterEach(() => {
  document.body.innerHTML = '';
});

describe('react <ModelViewer>: invalid input surfaces as a RangeError in the React tree', () => {
  it('a bad renderScope at mount (construction check) reaches the error boundary', async () => {
    const errors = await renderCaught((x) => createElement(ModelViewer, { ...modelProps, ...x } as never), {
      renderScope: { objectIds: 'nope' }
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as Error).message).toContain('objectIds');
  });
});

describe('react <ModelViewer>: capture before a canvas is bound', () => {
  it('rejects with CaptureUnsupportedError through the handle and through controls', async () => {
    const ref = createRef<ModelViewerHandle>();
    let hook: ModelViewerHandle | null = null;
    function Probe() {
      hook = useModelViewer(modelProps); // never attaches viewer.canvasRef
      return null;
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    await expect(hook!.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    await expect(hook!.controls.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    await act(async () => root.unmount());
    host.remove();
    void ref;
  });

  it('<ModelViewer> with a renderer that cannot render to a target rejects the same way after bind', async () => {
    const ref = createRef<ModelViewerHandle>();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(ModelViewer, { ref, ...modelProps } as never)));
    await settle();
    await expect(ref.current!.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    await act(async () => root.unmount());
    host.remove();
  });
});

// LAST on purpose: React 18 leaves its work loop wedged after an effect throws inside act.
describe('react <ModelViewer>: a bad prop applied after mount', () => {
  it('a bad renderScope set after mount (effect) reaches the error boundary', async () => {
    const errors = await renderCaught(
      (x) => createElement(ModelViewer, { ...modelProps, ...x } as never),
      { renderScope: { objectIds: ['a'] } },
      { renderScope: { plateId: 1.5 } }
    );
    expect(errors[0]).toBeInstanceOf(RangeError);
  });
});
