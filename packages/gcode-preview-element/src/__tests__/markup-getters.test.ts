// @vitest-environment happy-dom
/**
 * A value given in markup (or by `setAttribute`, before or while disconnected) is the value the property
 * getter reports, on both elements. `<gcode-model-viewer>`'s `pixelRatio`, `cameraFov` and `background`
 * are not reflected to their attributes, so the element records each valid attribute value itself; an
 * invalid attribute keeps the last valid value.
 */
import { describe, expect, it } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import {
  MODEL_STUB_CONTROLS,
  makeModelRecordingGL,
  makeStlModelSource
} from '@chestnutlabs/gcode-model-renderer/testing';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreviewElement, defineGcodePreview } from '../index';
import { GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

type RecordingGL = ReturnType<typeof makeModelRecordingGL>;

/** Recording GL that also logs every `setPixelRatio` call. */
function ratioRecordingGL(ratios: number[]): RecordingGL {
  const gl = makeModelRecordingGL();
  return {
    ...gl,
    createRenderer: (c: RenderTargetCanvas): GLRendererLike => ({
      ...gl.createRenderer(c),
      setPixelRatio: (r: number) => ratios.push(r)
    })
  };
}

function inject(el: GcodeModelViewerElement, gl: RecordingGL): GcodeModelViewerElement {
  el.createRenderer = gl.createRenderer;
  el.createControls = MODEL_STUB_CONTROLS;
  return el;
}

/** Parse `<gcode-model-viewer …>` markup into a detached host, inject the test renderer, then connect. */
function fromMarkup(attrs: string, gl: RecordingGL): GcodeModelViewerElement {
  defineGcodeModelViewer();
  const host = document.createElement('div');
  host.innerHTML = `<gcode-model-viewer ${attrs}></gcode-model-viewer>`;
  const el = host.firstElementChild as GcodeModelViewerElement;
  expect(el).toBeInstanceOf(GcodeModelViewerElement);
  inject(el, gl);
  document.body.appendChild(host);
  return el;
}

function make(gl: RecordingGL): GcodeModelViewerElement {
  defineGcodeModelViewer();
  return inject(document.createElement('gcode-model-viewer') as GcodeModelViewerElement, gl);
}

describe('<gcode-model-viewer> pixel-ratio given in markup', () => {
  it('the getter returns the markup ratio after connect (applied once)', async () => {
    const ratios: number[] = [];
    const el = fromMarkup('pixel-ratio="1.5"', ratioRecordingGL(ratios));
    await el.setSource(makeStlModelSource());
    expect(ratios).toEqual([1.5]);
    expect(el.pixelRatio).toBe(1.5);
    el.parentElement?.remove();
  });

  it('the getter reads a valid attribute before connect; "device" too', () => {
    const el = make(ratioRecordingGL([]));
    el.setAttribute('pixel-ratio', '0.5');
    expect(el.pixelRatio).toBe(0.5);
    el.setAttribute('pixel-ratio', 'device');
    expect(el.pixelRatio).toBe('device');
  });

  it('an invalid attribute before connect keeps the last valid ratio, and that ratio is applied', () => {
    const ratios: number[] = [];
    const el = make(ratioRecordingGL(ratios));
    el.setAttribute('pixel-ratio', '1.5');
    el.setAttribute('pixel-ratio', 'abc');
    expect(el.pixelRatio).toBe(1.5);
    document.body.appendChild(el);
    expect(ratios).toEqual([1.5]);
    expect(el.pixelRatio).toBe(1.5);
    el.remove();
  });

  it('only an invalid attribute: the getter stays undefined and no ratio is set', () => {
    const ratios: number[] = [];
    const el = make(ratioRecordingGL(ratios));
    el.setAttribute('pixel-ratio', '9');
    document.body.appendChild(el);
    expect(ratios).toEqual([]);
    expect(el.pixelRatio).toBeUndefined();
    el.remove();
  });

  it('a change while disconnected is applied at reconnect and reported by the getter', () => {
    const ratios: number[] = [];
    const el = fromMarkup('pixel-ratio="2"', ratioRecordingGL(ratios));
    el.remove();
    el.setAttribute('pixel-ratio', '3');
    ratios.length = 0;
    document.body.appendChild(el);
    expect(ratios).toEqual([3]);
    expect(el.pixelRatio).toBe(3);
    el.remove();
  });

  it('is not reflected: the property leaves the attribute alone', () => {
    const el = fromMarkup('pixel-ratio="2"', ratioRecordingGL([]));
    el.pixelRatio = 3;
    expect(el.getAttribute('pixel-ratio')).toBe('2');
    expect(el.pixelRatio).toBe(3);
    el.remove();
  });
});

describe('<gcode-model-viewer> camera-fov given in markup', () => {
  it('the getter returns the markup lens after connect', async () => {
    const gl = makeModelRecordingGL();
    const el = fromMarkup('camera-fov="32"', gl);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().fov).toBe(32);
    expect(el.cameraFov).toBe(32);
    el.parentElement?.remove();
  });

  it('an invalid attribute before connect keeps the last valid lens, and that lens is applied', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.setAttribute('camera-fov', '40');
    el.setAttribute('camera-fov', '121');
    expect(el.cameraFov).toBe(40);
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().fov).toBe(40);
    expect(el.cameraFov).toBe(40);
    el.remove();
  });

  it('only an invalid attribute: the getter stays undefined and the default lens is used', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    el.setAttribute('camera-fov', 'banana');
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().fov).toBe(50);
    expect(el.cameraFov).toBeUndefined();
    el.remove();
  });

  it('a change while disconnected is applied at reconnect and reported by the getter', async () => {
    const gl = makeModelRecordingGL();
    const el = fromMarkup('camera-fov="32"', gl);
    el.remove();
    el.setAttribute('camera-fov', '60');
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().fov).toBe(60);
    expect(el.cameraFov).toBe(60);
    el.remove();
  });
});

describe('<gcode-model-viewer> background given in markup', () => {
  it('the getter returns the markup background after connect, and it is drawn', async () => {
    const gl = makeModelRecordingGL();
    const el = fromMarkup('background="#112233"', gl);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().background).toBe('Color');
    expect(el.background).toBe('#112233');
    el.parentElement?.remove();
  });

  it('follows attribute changes after connect; removing the attribute keeps the last background', async () => {
    const gl = makeModelRecordingGL();
    const el = make(gl);
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    el.setAttribute('background', 'transparent');
    expect(el.background).toBe('transparent');
    expect(gl.snapshot().background).toBe('null');
    el.removeAttribute('background');
    expect(el.background).toBe('transparent');
    expect(gl.snapshot().background).toBe('null');
    el.remove();
  });

  it('a change while disconnected is applied at reconnect and reported by the getter', async () => {
    const gl = makeModelRecordingGL();
    const el = fromMarkup('background="#112233"', gl);
    el.remove();
    el.setAttribute('background', 'transparent');
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(gl.snapshot().background).toBe('null');
    expect(el.background).toBe('transparent');
    el.remove();
  });
});

describe('<gcode-model-viewer> upgraded after the markup was parsed', () => {
  it('attributes present before the element is defined are recorded at upgrade', async () => {
    const ratios: number[] = [];
    const gl = ratioRecordingGL(ratios);
    const host = document.createElement('div');
    host.innerHTML = '<late-model-viewer pixel-ratio="1.5" camera-fov="32" background="#112233"></late-model-viewer>';
    document.body.appendChild(host);
    // The element is connected but undefined; define() upgrades it. Browsers run the attribute callbacks
    // before connect; happy-dom skips them, so this covers the element reading its attributes at connect.
    // The test renderer is injected in the constructor, which runs first during the upgrade.
    class LateModelViewer extends GcodeModelViewerElement {
      constructor() {
        super();
        this.createRenderer = gl.createRenderer;
        this.createControls = MODEL_STUB_CONTROLS;
      }
    }
    customElements.define('late-model-viewer', LateModelViewer);
    const up = host.firstElementChild as GcodeModelViewerElement;
    expect(up).toBeInstanceOf(GcodeModelViewerElement);
    await up.setSource(makeStlModelSource());
    expect(ratios).toEqual([1.5]);
    expect(gl.snapshot()).toMatchObject({ fov: 32, background: 'Color' });
    expect(up.pixelRatio).toBe(1.5);
    expect(up.cameraFov).toBe(32);
    expect(up.background).toBe('#112233');
    host.remove();
  });
});

describe('<gcode-model-viewer> attributes that reflect (no recorded copy needed)', () => {
  it('show-volume-cage, view, interaction-quality and camera-mode given in markup read back', () => {
    const el = fromMarkup(
      'show-volume-cage="false" view="iso" interaction-quality="auto" camera-mode="perspective"',
      makeModelRecordingGL()
    );
    expect(el.showVolumeCage).toBe(false);
    expect(el.view).toBe('iso');
    expect(el.interactionQuality).toBe('auto');
    expect(el.cameraMode).toBe('perspective');
    el.parentElement?.remove();
  });
});

describe('<gcode-preview> attributes given in markup', () => {
  it('pixel-ratio, camera-fov and show-volume-cage read back after connect', async () => {
    defineGcodePreview();
    const ratios: number[] = [];
    const host = document.createElement('div');
    host.innerHTML = '<gcode-preview pixel-ratio="1.5" camera-fov="32" show-volume-cage="false"></gcode-preview>';
    const el = host.firstElementChild as GcodePreviewElement;
    expect(el).toBeInstanceOf(GcodePreviewElement);
    const canvas = document.createElement('canvas');
    el.createWorker = () => new SuiteStubWorker();
    el.quality = 'lines';
    el.rendererOptions = {
      createRenderer: () => ({ ...makeSuiteStubGL(canvas), setPixelRatio: (r: number) => ratios.push(r) }),
      scheduleFrame: (cb) => cb(),
      chunksPerTick: 8
    };
    document.body.appendChild(host);
    await settle();
    expect(ratios).toEqual([1.5]);
    expect(el.pixelRatio).toBe(1.5);
    expect(el.cameraFov).toBe(32);
    expect(el.showVolumeCage).toBe(false);
    host.remove();
  });
});
