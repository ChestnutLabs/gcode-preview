// @vitest-environment happy-dom
/**
 * #490 through `<gcode-model-viewer>`: the `show-volume-cage` attribute + `showVolumeCage` property, as on
 * `<gcode-preview>`: absent or anything but `"false"` draws the cage; the property reflects the attribute.
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import { GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';

function make(gl: ReturnType<typeof makeModelRecordingGL>): GcodeModelViewerElement {
  defineGcodeModelViewer();
  const el = document.createElement('gcode-model-viewer') as GcodeModelViewerElement;
  el.createRenderer = gl.createRenderer;
  el.createControls = MODEL_STUB_CONTROLS;
  el.buildVolume = { x: 100, y: 100, z: 100 };
  return el;
}

describe('<gcode-model-viewer> — show-volume-cage', () => {
  it('absent: the property reads true and the cage is drawn', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    expect(el.showVolumeCage).toBe(true);
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot()).toMatchObject({ plate: true, cage: true });
    el.remove();
  });

  it('show-volume-cage="false" set before connect hides the cage from the first frame', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.setAttribute('show-volume-cage', 'false');
    expect(el.showVolumeCage).toBe(false);
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot()).toMatchObject({ plate: true, cage: false });
    el.remove();
  });

  it('attribute changes after connect apply; any value but "false" shows it', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    el.setAttribute('show-volume-cage', 'false');
    expect(gl.snapshot().cage).toBe(false);
    el.setAttribute('show-volume-cage', '');
    expect(gl.snapshot().cage).toBe(true);
    el.setAttribute('show-volume-cage', 'false');
    el.removeAttribute('show-volume-cage');
    expect(gl.snapshot().cage).toBe(true);
    el.remove();
  });

  it('the property reflects to the attribute and drives the scene', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.showVolumeCage = false;
    expect(el.getAttribute('show-volume-cage')).toBe('false');
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().cage).toBe(false);
    el.showVolumeCage = true;
    expect(el.getAttribute('show-volume-cage')).toBe('true');
    expect(gl.snapshot().cage).toBe(true);
    el.remove();
  });

  it('survives a disconnect/reconnect', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.showVolumeCage = false;
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().cage).toBe(false);
    el.remove();
  });
});
