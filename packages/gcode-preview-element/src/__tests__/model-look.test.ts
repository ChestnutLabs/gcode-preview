// @vitest-environment happy-dom
/**
 * DD-032 through `<gcode-model-viewer>`: `buildVolume` / `theme` are properties only (object-valued), the
 * lens is the `camera-fov` attribute + `cameraFov` property. An invalid attribute is ignored and the last
 * valid lens kept; an invalid property value throws `RangeError` (like `controls.setCameraFov`).
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { studioTheme } from '@chestnutlabs/gcode-renderer-three';
import { GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function make(gl: ReturnType<typeof makeModelRecordingGL>): GcodeModelViewerElement {
  defineGcodeModelViewer();
  const el = document.createElement('gcode-model-viewer') as GcodeModelViewerElement;
  el.createRenderer = gl.createRenderer;
  el.createControls = MODEL_STUB_CONTROLS;
  return el;
}

describe('<gcode-model-viewer> — DD-032 look', () => {
  it('properties set before connect and after connect reach the scene and state', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.buildVolume = { x: 100, y: 100, z: 100 };
    el.theme = studioTheme('dark');
    el.setAttribute('camera-fov', '32');
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(el.state.placement).toBe('approximated');
    expect(el.state.placementOffset).toEqual({ x: 45, y: 40, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 32, plate: true, shadow: true, background: 'DataTexture' });

    el.buildVolume = { x: 200, y: 200, z: 100 };
    el.theme = { ...studioTheme('light'), background: null };
    el.cameraFov = 60;
    await settle();
    expect(el.state.placementOffset).toEqual({ x: 95, y: 90, z: 0 });
    expect(gl.snapshot()).toEqual({ fov: 60, plate: true, shadow: true, background: 'null' });

    el.buildVolume = null;
    expect(el.state.placement).toBeNull();
    expect(gl.snapshot().plate).toBe(false);
    el.remove();
  });

  it('camera-fov attribute: valid changes apply; invalid (non-numeric, out of range, removed) is ignored, last valid kept', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.setAttribute('camera-fov', '9999'); // invalid at connect → default lens, no throw
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().fov).toBe(50);
    el.setAttribute('camera-fov', '40');
    expect(gl.snapshot().fov).toBe(40);
    for (const bad of ['banana', '5', '121', '', ' ']) {
      expect(() => el.setAttribute('camera-fov', bad)).not.toThrow();
      expect(gl.snapshot().fov).toBe(40);
      expect(el.cameraFov).toBe(40);
    }
    el.removeAttribute('camera-fov');
    expect(gl.snapshot().fov).toBe(40);
    el.setAttribute('camera-fov', '10'); // inclusive bounds
    expect(gl.snapshot().fov).toBe(10);
    el.setAttribute('camera-fov', '120');
    expect(gl.snapshot().fov).toBe(120);
    el.remove();
  });

  it('property setters validate synchronously (before and after connect) and keep the last valid value', () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    expect(() => (el.cameraFov = 5)).toThrow(RangeError);
    expect(() => (el.theme = { gridOpacity: 3 })).toThrow(RangeError);
    expect(el.cameraFov).toBeUndefined();
    expect(el.theme).toBeUndefined();
    el.cameraFov = 32;
    document.body.appendChild(el);
    expect(() => (el.cameraFov = 121)).toThrow(RangeError);
    expect(el.cameraFov).toBe(32);
    el.remove();
  });

  it('the lens survives a disconnect/reconnect (the element rebuilds its controller)', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.cameraFov = 32;
    el.buildVolume = { x: 100, y: 100, z: 100 };
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot()).toMatchObject({ fov: 32, plate: true });
    el.remove();
  });
});
