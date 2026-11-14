// @vitest-environment happy-dom
/**
 * The toolpath side of the throw-surface comparison for the `/model` sweep: a NaN `layerRange` applied after
 * mount throws a `RangeError` out of the passive effect, the same channel an invalid `/model` prop uses
 * (see model-errors.test.ts). One test per file: React 18 leaves its work loop wedged after such a throw.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview } from '../index';
import { renderCaught } from './error-surface';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const toolpathProps = {
  createWorker: () => new SuiteStubWorker(),
  rendererOptions: {
    createRenderer: (c: HTMLCanvasElement) => makeSuiteStubGL(c),
    scheduleFrame: (cb: () => void) => cb()
  }
};

describe('react <GcodePreview>: a NaN layerRange after mount', () => {
  it('throws a RangeError out of the effect, like an invalid /model prop', async () => {
    const errors = await renderCaught(
      (x) => createElement(GcodePreview, { ...toolpathProps, ...x } as never),
      { layerRange: [0, 1] },
      { layerRange: [Number.NaN, 1] }
    );
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as Error).message).toContain('NaN');
  });
});
