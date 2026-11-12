// @vitest-environment happy-dom
/**
 * Core colour-mode validation: an invalid `colorMode` (a bad `range` / object `only`) throws a RangeError
 * synchronously, at construction and in `setColorMode`, before anything is stored or queued — so the previous
 * mode stays in effect and nothing bad is replayed into a renderer bound later. Literal expected values.
 */
import { describe, expect, it } from 'vitest';
import type { ColorMode, GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { createPreviewController } from '../index';
import { SuiteStubWorker, makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

const BLUE: ColorMode = { mode: 'single', color: [0, 0, 1] };
const RED: ColorMode = { mode: 'single', color: [1, 0, 0] };
const BAD_RANGE: ColorMode = { mode: 'feedrate', ramp: [[0, 0, 1]], range: [5, 1], fallback: [0, 0, 0] };
const BAD_ONLY: ColorMode = { mode: 'object', palette: [[1, 0, 0]], fallback: [0, 0, 0], only: 1.5 };
const INVERTED =
  'feedrate color range is inverted: lo 5 > hi 1. Pass [lo, hi] in ascending order; ' +
  'for a reversed scale, reverse the ramp instead';

function controller(colorMode?: ColorMode) {
  return createPreviewController({
    createWorker: () => new SuiteStubWorker(),
    renderer: {
      quality: 'lines',
      ...(colorMode !== undefined ? { colorMode } : {}),
      createRenderer: (canvas): GLRendererLike => makeSuiteStubGL(canvas as HTMLCanvasElement),
      scheduleFrame: (cb) => cb()
    }
  });
}

/** The colour mode the bound renderer holds (the 3D renderer's own field; read-only inspection). */
function boundMode(c: ReturnType<typeof controller>): ColorMode | undefined {
  return (c.raw.renderer() as unknown as { colorMode?: ColorMode } | null)?.colorMode;
}

describe('controller colour-mode validation', () => {
  it('renderer.colorMode is validated at construction', () => {
    expect(() => controller(BAD_RANGE)).toThrow(INVERTED);
    expect(() => controller(BAD_ONLY)).toThrow(
      "object color mode 'only' must be a 1-based integer object index, got 1.5"
    );
    expect(() => controller(BLUE).dispose()).not.toThrow();
  });

  it('before the renderer binds: a bad mode throws, is not queued, and does not replace the request', async () => {
    const c = controller();
    c.controls.setColorMode(BLUE);
    expect(() => c.controls.setColorMode(BAD_RANGE)).toThrow(INVERTED);
    expect(() => c.controls.setColorMode(BAD_ONLY)).toThrow(RangeError);
    c.bindCanvas(document.createElement('canvas'));
    expect(c.raw.renderer()).toBeNull(); // the 3D load is still pending
    await settle();
    expect(boundMode(c)).toEqual({ mode: 'single', color: [0, 0, 1] });
    c.dispose();
  });

  it('after the renderer binds: a bad mode throws, the previous mode stays, a valid one still applies', async () => {
    const c = controller(BLUE);
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(boundMode(c)).toEqual({ mode: 'single', color: [0, 0, 1] });
    expect(() => c.controls.setColorMode(BAD_RANGE)).toThrow(INVERTED);
    expect(boundMode(c)).toEqual({ mode: 'single', color: [0, 0, 1] });
    expect(c.controls.setColorMode(RED)).toBe(true);
    expect(boundMode(c)).toEqual({ mode: 'single', color: [1, 0, 0] });
    // A canvas rebind keeps the last VALID request.
    expect(() => c.controls.setColorMode(BAD_ONLY)).toThrow(RangeError);
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(boundMode(c)).toEqual({ mode: 'single', color: [1, 0, 0] });
    c.dispose();
  });
});
