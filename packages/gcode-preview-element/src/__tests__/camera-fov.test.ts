// @vitest-environment happy-dom
/**
 * DD-032: `<gcode-preview>`'s `camera-fov` attribute + `cameraFov` property. The property throws RangeError
 * out of range (attribute untouched); a bad attribute value is ignored silently and the last valid lens is
 * kept, also across a reconnect.
 */
import { describe, expect, it } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreviewElement, defineGcodePreview } from '../index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

function makeEl(): GcodePreviewElement {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.quality = 'lines';
  el.rendererOptions = {
    createRenderer: () => makeSuiteStubGL(canvas),
    scheduleFrame: (cb) => cb(),
    chunksPerTick: 8
  };
  return el;
}
const lens = (el: GcodePreviewElement): number => (el.raw.renderer() as unknown as { cameraFov: number }).cameraFov;

describe('<gcode-preview> camera-fov (DD-032)', () => {
  it('applies the attribute at connect and follows changes', async () => {
    const el = makeEl();
    el.setAttribute('camera-fov', '32');
    document.body.appendChild(el);
    await settle();
    expect(lens(el)).toBe(32);
    expect(el.cameraFov).toBe(32);
    el.setAttribute('camera-fov', '40');
    expect(lens(el)).toBe(40);
    el.remove();
  });

  it.each(['abc', '', ' ', '200', '9', '9.9999', '120.0001', '120.5', 'NaN'])(
    'ignores a bad attribute value (%j) and keeps the last lens',
    async (bad) => {
      const el = makeEl();
      el.setAttribute('camera-fov', '40');
      document.body.appendChild(el);
      await settle();
      expect(() => el.setAttribute('camera-fov', bad)).not.toThrow();
      expect(lens(el)).toBe(40);
      // The getter reports the effective lens, not the bad attribute.
      expect(el.cameraFov).toBe(40);
      el.remove();
    }
  );

  it('accepts the range ends 10 and 120', async () => {
    const el = makeEl();
    document.body.appendChild(el);
    await settle();
    el.setAttribute('camera-fov', '10');
    expect(lens(el)).toBe(10);
    el.setAttribute('camera-fov', '120');
    expect(lens(el)).toBe(120);
    el.remove();
  });

  it('a bad attribute present at connect falls back to the default 50', async () => {
    const el = makeEl();
    el.setAttribute('camera-fov', 'wide');
    document.body.appendChild(el);
    await settle();
    expect(lens(el)).toBe(50);
    el.remove();
  });

  it('removing the attribute keeps the current lens', async () => {
    const el = makeEl();
    el.setAttribute('camera-fov', '32');
    document.body.appendChild(el);
    await settle();
    el.removeAttribute('camera-fov');
    expect(lens(el)).toBe(32);
    el.remove();
  });

  it('the property reflects; out of range it throws RangeError and leaves the attribute alone', async () => {
    const el = makeEl();
    document.body.appendChild(el);
    await settle();
    el.cameraFov = 32;
    expect(el.getAttribute('camera-fov')).toBe('32');
    expect(lens(el)).toBe(32);
    expect(() => (el.cameraFov = 121)).toThrow(RangeError);
    expect(() => (el.cameraFov = 9)).toThrow('fov must be in [10, 120] degrees (got 9)');
    for (const bad of [9.5, 9.9999, 120.0001, 120.5]) expect(() => (el.cameraFov = bad)).toThrow(RangeError);
    expect(el.getAttribute('camera-fov')).toBe('32');
    el.cameraFov = 10;
    expect(lens(el)).toBe(10);
    el.cameraFov = 120;
    expect(lens(el)).toBe(120);
    el.cameraFov = 10;
    el.cameraFov = null;
    expect(el.hasAttribute('camera-fov')).toBe(false);
    expect(lens(el)).toBe(10);
    // Removing the attribute keeps the lens, and the getter says so.
    expect(el.cameraFov).toBe(10);
    el.remove();
  });

  it('the getter reports a valid attribute set before connect', () => {
    const el = makeEl();
    el.setAttribute('camera-fov', '32');
    expect(el.cameraFov).toBe(32);
    el.cameraFov = 40;
    expect(el.cameraFov).toBe(40);
  });

  it('a reconnect keeps the last valid lens even when the attribute later went bad', async () => {
    const el = makeEl();
    el.setAttribute('camera-fov', '24');
    document.body.appendChild(el);
    await settle();
    el.setAttribute('camera-fov', '999');
    el.remove();
    document.body.appendChild(el);
    await settle();
    expect(lens(el)).toBe(24);
    el.remove();
  });
});
