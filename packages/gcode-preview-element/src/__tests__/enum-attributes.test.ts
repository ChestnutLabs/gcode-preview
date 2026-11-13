// @vitest-environment happy-dom
/**
 * Enum attributes on `<gcode-preview>` and `<gcode-model-viewer>`: markup is like file data, so a value that is
 * not exactly one of the literals is ignored (the default at connect, the last value on a change) and never
 * throws, kills the renderer, or emits E_RENDERER_LOAD / E_CONTROL_REJECTED. A bad PROPERTY throws RangeError
 * before it reflects. capture() before connect rejects with CaptureUnsupportedError.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { CaptureUnsupportedError, ToolpathRenderer } from '@chestnutlabs/gcode-renderer-three';
import { type GcodePreviewElement, defineGcodePreview } from '../index';
import { type GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';
import { CAMERA_MODES, CAMERA_VIEWS, QUALITIES, assertEnum, pickEnum } from '../enums';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function makePreview(attrs: Record<string, string> = {}): { el: GcodePreviewElement; errors: string[] } {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb(), chunksPerTick: 8 };
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const errors: string[] = [];
  el.addEventListener('error', (e) => errors.push((e as CustomEvent<{ code: string }>).detail.code));
  return { el, errors };
}

function makeModel(attrs: Record<string, string> = {}): { el: GcodeModelViewerElement; errors: string[] } {
  defineGcodeModelViewer();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-model-viewer') as GcodeModelViewerElement;
  el.createRenderer = () => makeSuiteStubGL(canvas) as never;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  const errors: string[] = [];
  el.addEventListener('error', (e) => errors.push((e as CustomEvent<{ code: string }>).detail.code));
  return { el, errors };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** attribute, a valid value, the control method it drives, the property name. */
const PREVIEW_ENUMS = [
  ['quality', 'tubes', 'setQuality', 'quality'],
  ['quality-mode', 'fast', 'setQualityMode', 'qualityMode'],
  ['progressive-preview', 'hold', 'setProgressivePreview', 'progressivePreview'],
  ['camera-mode', 'orthographic', 'setCameraMode', 'cameraMode'],
  ['frame-content', 'all', 'setFrameContent', 'frameContent'],
  ['interaction-quality', 'off', 'setInteractionQuality', 'interactionQuality'],
  ['view', 'top', 'setView', 'view']
] as const;

describe('<gcode-preview> enum attributes', () => {
  for (const [attr, good, method, prop] of PREVIEW_ENUMS) {
    for (const bad of ['foo', '', 'TOP', ' top', 'Tubes', 'null']) {
      it(`${attr}=${JSON.stringify(bad)} at connect: ignored, renderer built, no error`, async () => {
        const { el, errors } = makePreview({ [attr]: bad });
        expect(() => document.body.appendChild(el)).not.toThrow();
        await settle();
        expect(errors).toEqual([]);
        expect(el.raw.renderer()).toBeInstanceOf(ToolpathRenderer);
        el.remove();
      });
    }

    it(`${attr} change: a bad value is ignored (never throws), a valid one is applied`, async () => {
      const { el, errors } = makePreview();
      document.body.appendChild(el);
      await settle();
      const spy = vi.spyOn(el.controls, method);
      for (const bad of ['foo', '', 'TOP']) {
        expect(() => el.setAttribute(attr, bad)).not.toThrow();
      }
      expect(spy).not.toHaveBeenCalled();
      el.setAttribute(attr, good);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(good);
      expect(errors).toEqual([]);
      el.remove();
    });

    it(`${prop} property: a bad value throws RangeError and leaves the attribute alone; null clears`, () => {
      const { el } = makePreview();
      const el2 = el as unknown as Record<string, string | null>;
      el2[prop] = good;
      expect(el.getAttribute(attr)).toBe(good);
      for (const bad of ['foo', '', 'Top', ' top']) {
        expect(() => (el2[prop] = bad)).toThrow(RangeError);
        expect(el.getAttribute(attr)).toBe(good);
      }
      expect(() => (el2[prop] = 'foo')).toThrow(`${prop} must be '`);
      el2[prop] = null;
      expect(el.hasAttribute(attr)).toBe(false);
    });
  }

  it('quality removed means the default (auto); a bad one does nothing', async () => {
    const { el } = makePreview({ quality: 'tubes' });
    document.body.appendChild(el);
    await settle();
    const spy = vi.spyOn(el.controls, 'setQuality');
    el.setAttribute('quality', 'bogus');
    expect(spy).not.toHaveBeenCalled();
    el.removeAttribute('quality');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('auto');
    el.remove();
  });

  it('a bad camera-mode at connect keeps the default (perspective); a valid one applies', async () => {
    const bad = makePreview({ 'camera-mode': 'foo' });
    document.body.appendChild(bad.el);
    await settle();
    expect(bad.el.controls.getCameraState()?.cameraMode).toBe('perspective');
    const ok = makePreview({ 'camera-mode': 'orthographic' });
    document.body.appendChild(ok.el);
    await settle();
    expect(ok.el.controls.getCameraState()?.cameraMode).toBe('orthographic');
  });

  it('a bad view at connect sets no view and emits no E_CONTROL_REJECTED; a valid one is applied', async () => {
    const bad = makePreview({ view: 'foo' });
    const badSpy = vi.fn();
    document.body.appendChild(bad.el);
    await settle();
    expect(bad.errors).toEqual([]);
    void badSpy;
    const good = makePreview({ view: 'top' });
    document.body.appendChild(good.el);
    await settle();
    expect(good.errors).toEqual([]);
    expect(good.el.controls.getCameraState()?.position.y).toBeGreaterThan(0);
  });

  it('renderer="foo" renders the default 3D renderer, explicitly; "3d" and "2d" are honoured', async () => {
    const foo = makePreview({ renderer: 'foo' });
    document.body.appendChild(foo.el);
    await settle();
    expect(foo.errors).toEqual([]);
    expect(foo.el.raw.renderer()).toBeInstanceOf(ToolpathRenderer);
    const two = makePreview({ renderer: '2d' });
    document.body.appendChild(two.el);
    await settle();
    expect(two.el.raw.renderer()).not.toBeInstanceOf(ToolpathRenderer);
    expect(two.el.raw.renderer()).not.toBeNull();
    const three = makePreview({ renderer: '3d' });
    document.body.appendChild(three.el);
    await settle();
    expect(three.el.raw.renderer()).toBeInstanceOf(ToolpathRenderer);
  });

  it('the renderer property validates (RangeError) before it reflects', () => {
    const { el } = makePreview();
    el.renderer = '2d';
    expect(el.getAttribute('renderer')).toBe('2d');
    expect(() => (el.renderer = '4d')).toThrow(RangeError);
    expect(el.getAttribute('renderer')).toBe('2d');
    el.renderer = null;
    expect(el.hasAttribute('renderer')).toBe(false);
  });

  it('capture() before connect rejects with CaptureUnsupportedError (no synchronous throw)', async () => {
    const { el } = makePreview();
    let p: Promise<Blob> | undefined;
    expect(() => (p = el.capture())).not.toThrow();
    await expect(p).rejects.toBeInstanceOf(CaptureUnsupportedError);
    await expect(p).rejects.toMatchObject({ code: 'E_CAPTURE_UNSUPPORTED' });
  });
});

describe('<gcode-model-viewer> enum attributes', () => {
  for (const bad of ['foo', '', 'ISO', ' iso', 'null']) {
    it(`view=${JSON.stringify(bad)} at connect: ignored, no throw, no error`, async () => {
      const { el, errors } = makeModel({ view: bad });
      expect(() => document.body.appendChild(el)).not.toThrow();
      await settle();
      expect(errors).toEqual([]);
      el.remove();
    });
    it(`camera-mode / interaction-quality=${JSON.stringify(bad)} at connect: ignored, no throw, no error`, async () => {
      const { el, errors } = makeModel({ 'camera-mode': bad, 'interaction-quality': bad });
      expect(() => document.body.appendChild(el)).not.toThrow();
      await settle();
      expect(errors).toEqual([]);
      el.remove();
    });
  }

  it('view and interaction-quality change: a bad value is ignored, a valid one applied', async () => {
    const { el } = makeModel();
    document.body.appendChild(el);
    await settle();
    const view = vi.spyOn(el.controls, 'setView');
    const iq = vi.spyOn(el.controls, 'setInteractionQuality');
    for (const bad of ['foo', '', 'ISO']) {
      expect(() => el.setAttribute('view', bad)).not.toThrow();
      expect(() => el.setAttribute('interaction-quality', bad)).not.toThrow();
    }
    expect(view).not.toHaveBeenCalled();
    expect(iq).not.toHaveBeenCalled();
    el.setAttribute('view', 'top');
    el.setAttribute('interaction-quality', 'off');
    expect(view).toHaveBeenCalledTimes(1);
    expect(view).toHaveBeenCalledWith('top');
    expect(iq).toHaveBeenCalledTimes(1);
    expect(iq).toHaveBeenCalledWith('off');
    el.remove();
  });

  it('a valid view / camera-mode / interaction-quality at connect is applied', async () => {
    const { el } = makeModel({ view: 'top', 'camera-mode': 'orthographic', 'interaction-quality': 'off' });
    document.body.appendChild(el);
    await settle();
    expect(el.controls.getCameraState()?.cameraMode).toBe('orthographic');
    expect(el.controls.getCameraState()?.position.y).toBeGreaterThan(0);
    el.remove();
  });

  for (const [prop, attr, good] of [
    ['view', 'view', 'front'],
    ['interactionQuality', 'interaction-quality', 'auto'],
    ['cameraMode', 'camera-mode', 'orthographic']
  ] as const) {
    it(`${prop} property: a bad value throws RangeError before it reflects; null clears`, () => {
      const { el } = makeModel();
      const rec = el as unknown as Record<string, string | null>;
      rec[prop] = good;
      expect(el.getAttribute(attr)).toBe(good);
      for (const bad of ['foo', '', 'Front']) {
        expect(() => (rec[prop] = bad)).toThrow(RangeError);
        expect(el.getAttribute(attr)).toBe(good);
      }
      rec[prop] = null;
      expect(el.hasAttribute(attr)).toBe(false);
    });
  }

  it('capture() before connect rejects with CaptureUnsupportedError (no synchronous throw)', async () => {
    const { el } = makeModel();
    let p: Promise<Blob> | undefined;
    expect(() => (p = el.capture())).not.toThrow();
    await expect(p).rejects.toBeInstanceOf(CaptureUnsupportedError);
  });

  it('renderScope: a bad scope throws RangeError in the setter, connected or not, and is not stored', async () => {
    const { el, errors } = makeModel();
    expect(() => (el.renderScope = { plateId: 1.5 } as never)).toThrow(RangeError);
    expect(() => (el.renderScope = { objectIds: 'x' } as never)).toThrow(RangeError);
    expect(() => (el.renderScope = {} as never)).toThrow(RangeError);
    expect(el.renderScope).toBeNull();
    el.renderScope = { plateId: 1 };
    expect(el.renderScope).toEqual({ plateId: 1 });
    // The stored good scope reaches connect without throwing out of connectedCallback.
    expect(() => document.body.appendChild(el)).not.toThrow();
    await settle();
    expect(errors).toEqual([]);
    expect(() => (el.renderScope = { plateId: 1.5 } as never)).toThrow(RangeError);
    expect(el.renderScope).toEqual({ plateId: 1 });
    el.renderScope = null;
    expect(el.renderScope).toBeNull();
  });
});

describe('enum helpers', () => {
  it('pickEnum accepts only exact members', () => {
    expect(pickEnum(QUALITIES, 'tubes')).toBe('tubes');
    expect(pickEnum(QUALITIES, 'Tubes')).toBeUndefined();
    expect(pickEnum(QUALITIES, null)).toBeUndefined();
    expect(pickEnum(QUALITIES, '')).toBeUndefined();
  });
  it('assertEnum allows null and members, throws a RangeError naming the options otherwise', () => {
    expect(() => assertEnum('x', CAMERA_MODES, null)).not.toThrow();
    expect(() => assertEnum('x', CAMERA_MODES, 'perspective')).not.toThrow();
    expect(() => assertEnum('x', CAMERA_MODES, 'foo')).toThrow("x must be 'perspective', 'orthographic' (got foo)");
  });
  it('the literal lists are exactly the documented values', () => {
    expect([...CAMERA_VIEWS]).toEqual(['top', 'bottom', 'front', 'back', 'left', 'right', 'iso']);
    expect([...QUALITIES]).toEqual(['auto', 'lines', 'tubes']);
  });
});
