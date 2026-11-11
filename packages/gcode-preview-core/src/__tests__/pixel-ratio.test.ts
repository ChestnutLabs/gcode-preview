// @vitest-environment happy-dom
/**
 * Core pixel ratio: `renderer.pixelRatio` + `setPixelRatio` reach the 3D renderer, a synchronous range
 * check before the on-demand load, kept across canvas rebinds, and the 2D disclosure. Literal expected values.
 */
import { describe, expect, it } from 'vitest';
import type { GLRendererLike, PixelRatioOption } from '@chestnutlabs/gcode-renderer-three';
import { createPreviewController, type PreviewEvent } from '../index';
import { SuiteStubWorker, makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Every GL the controller creates, in order, with the ratios handed to it. */
function controller(pixelRatio?: PixelRatioOption) {
  const gls: number[][] = [];
  const c = createPreviewController({
    createWorker: () => new SuiteStubWorker(),
    renderer: {
      quality: 'lines',
      ...(pixelRatio !== undefined ? { pixelRatio } : {}),
      createRenderer: (canvas): GLRendererLike => {
        const ratios: number[] = [];
        gls.push(ratios);
        return { ...makeSuiteStubGL(canvas as HTMLCanvasElement), setPixelRatio: (r) => ratios.push(r) };
      },
      scheduleFrame: (cb) => cb()
    }
  });
  return { c, gls };
}

describe('controller pixel ratio', () => {
  it('renderer.pixelRatio reaches the 3D renderer; unset never sets one', async () => {
    const a = controller(2);
    a.c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(a.gls).toEqual([[2]]);
    a.c.dispose();
    const b = controller();
    b.c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(b.gls).toEqual([[]]);
    b.c.dispose();
  });

  it.each([0, -1, 4.0001, NaN, 'Device', ' device'])(
    'renderer.pixelRatio %s throws RangeError at construction',
    (v) => {
      expect(() => controller(v as PixelRatioOption)).toThrow(RangeError);
    }
  );

  it('accepts 4 and "device" at construction', () => {
    expect(() => controller(4).c.dispose()).not.toThrow();
    expect(() => controller('device').c.dispose()).not.toThrow();
  });

  it('setPixelRatio throws synchronously before the 3D load, and a valid ratio reaches the renderer', async () => {
    const a = controller();
    a.c.bindCanvas(document.createElement('canvas'));
    expect(a.c.raw.renderer()).toBeNull(); // the 3D load is still pending
    expect(() => a.c.controls.setPixelRatio(0)).toThrow(RangeError);
    expect(() => a.c.controls.setPixelRatio(4.0001)).toThrow(RangeError);
    a.c.controls.setPixelRatio(1.5);
    await settle();
    expect(a.gls[0]).toEqual([1.5]);
    a.c.controls.setPixelRatio(4);
    expect(a.gls[0]).toEqual([1.5, 4]);
    a.c.dispose();
  });

  it('a canvas rebind keeps the last ratio; a rejected one does not replace it', async () => {
    const a = controller(2);
    a.c.bindCanvas(document.createElement('canvas'));
    await settle();
    a.c.controls.setPixelRatio(1.5);
    expect(() => a.c.controls.setPixelRatio(5)).toThrow(RangeError);
    a.c.bindCanvas(null);
    a.c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(a.gls[1]).toEqual([1.5]);
    a.c.dispose();
  });

  it('the 2D renderer discloses the pixel ratio as renderer-unsupported (a documented parity difference)', () => {
    const c = createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer: { mode: '2d' } });
    const canvas = document.createElement('canvas');
    (canvas as unknown as { getContext: () => unknown }).getContext = () => null;
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    c.bindCanvas(canvas);
    c.controls.setPixelRatio(2);
    const u = events.find((e) => e.type === 'renderer-unsupported') as { feature?: string } | undefined;
    expect(u?.feature).toBe('quality');
    expect(() => c.controls.setPixelRatio(0)).toThrow(RangeError);
    c.dispose();
  });
});
