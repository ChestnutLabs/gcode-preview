// @vitest-environment happy-dom
/**
 * React StrictMode runs every effect setup -> cleanup -> setup, so the `/model` hook disposes its controller and
 * must rebuild it and rebind the canvas it already holds (a ref never re-fires). Asserted through what is DRAWN:
 * the scope + source applied by the component's effects reach a frame after the remount, and a handle that was
 * disposed by hand comes back to life on the next call.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { StrictMode, act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeTwoObjectModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { ModelViewer, type ModelViewerHandle } from '../model/index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

afterEach(() => {
  document.body.innerHTML = '';
});

async function mountStrict() {
  const gl = makeModelRecordingGL();
  const ref = createRef<ModelViewerHandle>();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(ModelViewer, {
          ref,
          source: makeTwoObjectModelSource(),
          renderScope: { objectIds: ['a'] },
          createRenderer: gl.createRenderer,
          createControls: MODEL_STUB_CONTROLS
        } as never)
      )
    );
  });
  await settle();
  return { gl, ref, root };
}

describe('react <ModelViewer> under StrictMode', () => {
  it('draws the scoped source after the dispose/recreate cycle (canvas rebound to the fresh controller)', async () => {
    const { gl, ref, root } = await mountStrict();
    expect(gl.drawn().objects).toBe(1);
    expect(ref.current!.state.ready).toBe(true);
    await act(async () => root.unmount());
  });

  it('a handle disposed by hand rebuilds on the next call and draws again', async () => {
    const { gl, ref, root } = await mountStrict();
    ref.current!.dispose();
    await act(async () => {
      await ref.current!.setSource(makeTwoObjectModelSource());
    });
    await settle();
    expect(ref.current!.state.ready).toBe(true);
    expect(gl.drawn().objects).toBe(1); // the rebuilt controller starts from the construction options (scope 'a')
    await act(async () => root.unmount());
  });
});
