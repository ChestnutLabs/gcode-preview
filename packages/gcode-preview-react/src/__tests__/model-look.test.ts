// @vitest-environment happy-dom
/**
 * DD-032 through the REACT `/model` adapter: the declarative `buildVolume` / `theme` / `cameraFov` props
 * reach the scene (plate, shadow, gradient, lens) and `state.placement` / `placementOffset`, and re-apply
 * when they change.
 */
import { describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { studioTheme } from '@chestnutlabs/gcode-renderer-three';
import { ModelViewer, type ModelViewerHandle, type ModelViewerProps } from '../model/index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

describe('react <ModelViewer> — DD-032 look props', () => {
  it('buildVolume / theme / cameraFov props reach the scene and state, and re-apply when changed', async () => {
    const gl = makeModelRecordingGL();
    const handle = createRef<ModelViewerHandle>();
    const source = makeStlModelSource();
    const render = (extra: ModelViewerProps) =>
      createElement(ModelViewer, {
        ref: handle,
        source,
        createRenderer: gl.createRenderer,
        createControls: MODEL_STUB_CONTROLS,
        ...extra
      });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(render({ buildVolume: { x: 100, y: 100, z: 100 }, theme: studioTheme('dark'), cameraFov: 32 }));
    });
    await settle();
    expect(handle.current!.state.placement).toBe('approximated');
    expect(handle.current!.state.placementOffset).toEqual({ x: 45, y: 40, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 32, plate: true, cage: true, shadow: true, background: 'DataTexture' });

    await act(async () => {
      root.render(
        render({
          buildVolume: { x: 200, y: 200, z: 100 },
          theme: { ...studioTheme('light'), background: null },
          cameraFov: 60
        })
      );
    });
    await settle();
    expect(handle.current!.state.placementOffset).toEqual({ x: 95, y: 90, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 60, plate: true, cage: true, shadow: true, background: 'null' });

    await act(async () => {
      root.render(render({ buildVolume: null, theme: { ...studioTheme('light'), background: null }, cameraFov: 60 }));
    });
    await settle();
    expect(handle.current!.state.placement).toBeNull();
    expect(gl.snapshot().plate).toBe(false);
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
