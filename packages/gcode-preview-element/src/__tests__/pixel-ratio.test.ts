// @vitest-environment happy-dom
/**
 * `<gcode-preview>` and `<gcode-model-viewer>`: the `pixel-ratio` attribute + `pixelRatio` property. The
 * property throws `RangeError` for anything but (0, 4] or exactly `'device'`; a bad attribute is ignored
 * silently and the last valid ratio kept (attribute callbacks must not throw), as for `camera-fov`.
 */
import { describe, expect, it } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { MODEL_STUB_CONTROLS, makeStlModelSource } from '@chestnutlabs/gcode-model-renderer/testing';
import type { GLRendererLike, PixelRatioOption, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreviewElement, defineGcodePreview } from '../index';
import { GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const ratioGL = (canvas: RenderTargetCanvas, ratios: number[]): GLRendererLike => ({
  ...makeSuiteStubGL(canvas as HTMLCanvasElement),
  setPixelRatio: (r) => ratios.push(r)
});

const BAD_ATTRS = ['abc', '', ' ', '0', '-1', '4.0001', '5', 'NaN', 'Device', ' device', 'DEVICE'];
const BAD_PROPS: unknown[] = [0, -1, 4.0001, Number.NaN, Number.POSITIVE_INFINITY, 'Device', ' device', '2'];

function makeEl(ratios: number[]): GcodePreviewElement {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.quality = 'lines';
  el.rendererOptions = { createRenderer: () => ratioGL(canvas, ratios), scheduleFrame: (cb) => cb(), chunksPerTick: 8 };
  return el;
}

describe('<gcode-preview> pixel-ratio', () => {
  it('applies the attribute at connect and follows changes; "device" is accepted', async () => {
    const ratios: number[] = [];
    const el = makeEl(ratios);
    el.setAttribute('pixel-ratio', '2');
    document.body.appendChild(el);
    await settle();
    expect(ratios).toEqual([2]);
    expect(el.pixelRatio).toBe(2);
    el.setAttribute('pixel-ratio', '4');
    expect(ratios).toEqual([2, 4]);
    el.setAttribute('pixel-ratio', 'device');
    expect(el.pixelRatio).toBe('device');
    el.remove();
  });

  it.each(BAD_ATTRS)('ignores a bad attribute value (%j) and keeps the last ratio', async (bad) => {
    const ratios: number[] = [];
    const el = makeEl(ratios);
    el.setAttribute('pixel-ratio', '1.5');
    document.body.appendChild(el);
    await settle();
    expect(() => el.setAttribute('pixel-ratio', bad)).not.toThrow();
    expect(ratios).toEqual([1.5]);
    expect(el.pixelRatio).toBe(1.5);
    el.remove();
  });

  it('the property reflects to the attribute; a bad value throws and leaves the attribute', async () => {
    const ratios: number[] = [];
    const el = makeEl(ratios);
    document.body.appendChild(el);
    await settle();
    el.pixelRatio = 3;
    expect(el.getAttribute('pixel-ratio')).toBe('3');
    expect(ratios).toEqual([3]);
    el.pixelRatio = 'device';
    expect(el.getAttribute('pixel-ratio')).toBe('device');
    for (const bad of BAD_PROPS) {
      expect(() => {
        el.pixelRatio = bad as PixelRatioOption;
      }).toThrow(RangeError);
      expect(el.getAttribute('pixel-ratio')).toBe('device');
    }
    el.pixelRatio = null;
    expect(el.hasAttribute('pixel-ratio')).toBe(false);
    expect(el.pixelRatio).toBe('device'); // the last valid ratio stays in effect
    el.remove();
  });

  it('reads the effective ratio before connect; null when never set', () => {
    const el = makeEl([]);
    expect(el.pixelRatio).toBeNull();
    el.setAttribute('pixel-ratio', '0.5');
    expect(el.pixelRatio).toBe(0.5);
  });

  it('a reconnect keeps the last valid ratio over a bad attribute', async () => {
    const ratios: number[] = [];
    const el = makeEl(ratios);
    el.setAttribute('pixel-ratio', '2');
    document.body.appendChild(el);
    await settle();
    el.setAttribute('pixel-ratio', 'nope');
    el.remove();
    ratios.length = 0;
    document.body.appendChild(el);
    await settle();
    expect(ratios).toEqual([2]);
    el.remove();
  });
});

function makeModel(ratios: number[]): GcodeModelViewerElement {
  defineGcodeModelViewer();
  const el = document.createElement('gcode-model-viewer') as GcodeModelViewerElement;
  el.createRenderer = (c) => ratioGL(c, ratios);
  el.createControls = MODEL_STUB_CONTROLS;
  return el;
}

describe('<gcode-model-viewer> pixel-ratio', () => {
  it('attribute: applies at connect and on change; invalid is ignored, last valid kept', async () => {
    const ratios: number[] = [];
    const el = makeModel(ratios);
    el.setAttribute('pixel-ratio', '2');
    document.body.appendChild(el);
    await el.setSource(makeStlModelSource());
    expect(ratios).toEqual([2]);
    el.setAttribute('pixel-ratio', '4');
    expect(ratios).toEqual([2, 4]);
    expect(el.pixelRatio).toBe(4);
    for (const bad of BAD_ATTRS) {
      expect(() => el.setAttribute('pixel-ratio', bad)).not.toThrow();
      expect(ratios).toEqual([2, 4]);
      expect(el.pixelRatio).toBe(4);
    }
    el.setAttribute('pixel-ratio', 'device');
    expect(el.pixelRatio).toBe('device');
    el.remove();
  });

  it('an invalid attribute at connect is ignored (no ratio set), never thrown', () => {
    const ratios: number[] = [];
    const el = makeModel(ratios);
    el.setAttribute('pixel-ratio', '9');
    expect(() => document.body.appendChild(el)).not.toThrow();
    expect(ratios).toEqual([]);
    el.remove();
  });

  it('property: validated before and after connect; the pre-connect value applies at connect', () => {
    const ratios: number[] = [];
    const el = makeModel(ratios);
    for (const bad of BAD_PROPS) {
      expect(() => {
        el.pixelRatio = bad as PixelRatioOption;
      }).toThrow(RangeError);
    }
    expect(el.pixelRatio).toBeUndefined();
    el.pixelRatio = 1.5;
    document.body.appendChild(el);
    expect(ratios).toEqual([1.5]);
    el.pixelRatio = 3;
    expect(ratios).toEqual([1.5, 3]);
    expect(() => {
      el.pixelRatio = 4.0001;
    }).toThrow(RangeError);
    expect(el.pixelRatio).toBe(3);
    el.remove();
  });
});
