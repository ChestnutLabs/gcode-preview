// @vitest-environment happy-dom
/** The declarative `pixelRatio` prop on `<GcodePreview>` and the `/model` `<ModelViewer>` (react). */
import { describe, expect, it } from 'vitest';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { MODEL_STUB_CONTROLS, makeStlModelSource } from '@chestnutlabs/gcode-model-renderer/testing';
import type { GLRendererLike, PixelRatioOption, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import { GcodePreview } from '../index';
import { ModelViewer } from '../model/index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

/** A stub GL that records every ratio handed to it into `ratios`, and into `log` before or after renders. */
const ratioGL = (canvas: RenderTargetCanvas, ratios: number[], log: string[] = []): GLRendererLike => ({
  ...makeSuiteStubGL(canvas as HTMLCanvasElement),
  render: () => log.push('render'),
  setPixelRatio: (r) => {
    ratios.push(r);
    log.push(`ratio ${r}`);
  }
});

async function run(el: (ratio: PixelRatioOption | undefined) => ReactElement, steps: (PixelRatioOption | undefined)[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  for (const s of steps) {
    await act(async () => root.render(el(s)));
    await settle();
  }
  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
}

describe('<GcodePreview> pixelRatio (react)', () => {
  it('applies the mount value, follows changes, and keeps the ratio when unset', async () => {
    const canvas = document.createElement('canvas');
    const ratios: number[] = [];
    const log: string[] = [];
    const el = (pixelRatio: PixelRatioOption | undefined) =>
      createElement(GcodePreview, {
        source: null,
        quality: 'lines',
        pixelRatio,
        createWorker: () => new SuiteStubWorker(),
        rendererOptions: {
          createRenderer: () => ratioGL(canvas, ratios, log),
          scheduleFrame: (cb: () => void) => cb(),
          chunksPerTick: 8
        }
      });
    const done = await run(el, [2]);
    expect(ratios).toEqual([2]);
    expect(log[0]).toBe('ratio 2'); // built with it (a construction option): set before the first frame
    await done();
    const ratios2: number[] = [];
    const el2 = (pixelRatio: PixelRatioOption | undefined) =>
      createElement(GcodePreview, {
        source: null,
        quality: 'lines',
        pixelRatio,
        createWorker: () => new SuiteStubWorker(),
        rendererOptions: {
          createRenderer: () => ratioGL(canvas, ratios2),
          scheduleFrame: (cb: () => void) => cb(),
          chunksPerTick: 8
        }
      });
    const done2 = await run(el2, [undefined, 1.5, undefined]);
    expect(ratios2).toEqual([1.5]);
    await done2();
  });
});

describe('react <ModelViewer> pixelRatio', () => {
  it('applies the mount value and follows changes', async () => {
    const ratios: number[] = [];
    const log: string[] = [];
    const source = makeStlModelSource();
    const el = (pixelRatio: PixelRatioOption | undefined) =>
      createElement(ModelViewer, {
        source,
        pixelRatio,
        createRenderer: (c: RenderTargetCanvas) => ratioGL(c, ratios, log),
        createControls: MODEL_STUB_CONTROLS
      });
    const done = await run(el, [3, 0.5]);
    expect(ratios).toEqual([3, 0.5]);
    expect(log[0]).toBe('ratio 3');
    await done();
  });
});
