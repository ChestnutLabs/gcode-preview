// @vitest-environment happy-dom
/** #490 through the REACT `/model` adapter: the `showVolumeCage` prop (default true) reaches the scene. */
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { ModelViewer, type ModelViewerProps } from '../model/index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

describe('react <ModelViewer> — showVolumeCage', () => {
  it('omitted draws the cage; false hides it; true and omitted bring it back', async () => {
    const gl = makeModelRecordingGL();
    const source = makeStlModelSource();
    const render = (extra: ModelViewerProps) =>
      createElement(ModelViewer, {
        source,
        buildVolume: { x: 100, y: 100, z: 100 },
        createRenderer: gl.createRenderer,
        createControls: MODEL_STUB_CONTROLS,
        ...extra
      });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(render({}));
    });
    await settle();
    expect(gl.snapshot()).toMatchObject({ plate: true, cage: true });
    await act(async () => {
      root.render(render({ showVolumeCage: false }));
    });
    await settle();
    expect(gl.snapshot()).toMatchObject({ plate: true, cage: false });
    await act(async () => {
      root.render(render({ showVolumeCage: true }));
    });
    await settle();
    expect(gl.snapshot().cage).toBe(true);
    await act(async () => {
      root.render(render({ showVolumeCage: false }));
    });
    await act(async () => {
      root.render(render({}));
    });
    await settle();
    expect(gl.snapshot().cage).toBe(true);
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it('false on the first render is applied before the model shows', async () => {
    const gl = makeModelRecordingGL();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(ModelViewer, {
          source: makeStlModelSource(),
          buildVolume: { x: 100, y: 100, z: 100 },
          showVolumeCage: false,
          createRenderer: gl.createRenderer,
          createControls: MODEL_STUB_CONTROLS
        })
      );
    });
    await settle();
    expect(gl.snapshot()).toMatchObject({ plate: true, cage: false });
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
