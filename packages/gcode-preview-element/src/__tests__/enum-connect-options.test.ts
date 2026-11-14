// @vitest-environment happy-dom
/**
 * What `<gcode-preview>` hands to `createPreviewController` at connect for the enum attributes: an exact
 * literal, or nothing (the default) for a value that is not one. Pins the option object directly, so a core
 * that later validates `mode` / `qualityMode` (or a typo that reaches it) cannot turn markup into a failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import * as core from '@chestnutlabs/gcode-preview-core';
import { type GcodePreviewElement, defineGcodePreview } from '../index';

vi.mock('@chestnutlabs/gcode-preview-core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@chestnutlabs/gcode-preview-core')>();
  return { ...real, createPreviewController: vi.fn(real.createPreviewController) };
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

type Opts = { renderer: Record<string, unknown> };
async function connectOptions(attrs: Record<string, string>): Promise<Record<string, unknown>> {
  defineGcodePreview();
  const spy = vi.mocked(core.createPreviewController);
  spy.mockClear();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb() };
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await settle();
  el.remove();
  expect(spy).toHaveBeenCalledTimes(1);
  return (spy.mock.calls[0][0] as Opts).renderer;
}

afterEach(() => {
  document.body.replaceChildren();
});

const KEYS = [
  'mode',
  'quality',
  'qualityMode',
  'progressivePreview',
  'cameraMode',
  'frameContent',
  'interactionQuality'
];
const pick = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(KEYS.map((k) => [k, r[k]]));

describe('<gcode-preview> enum attributes reach the controller as exact literals', () => {
  it('valid values are passed through', async () => {
    const r = await connectOptions({
      renderer: '3d',
      quality: 'tubes',
      'quality-mode': 'fast',
      'progressive-preview': 'hold',
      'camera-mode': 'orthographic',
      'frame-content': 'object',
      'interaction-quality': 'off'
    });
    expect(pick(r)).toEqual({
      mode: '3d',
      quality: 'tubes',
      qualityMode: 'fast',
      progressivePreview: 'hold',
      cameraMode: 'orthographic',
      frameContent: 'object',
      interactionQuality: 'off'
    });
  });

  it('bad values are not passed: quality falls back to auto, the rest to nothing', async () => {
    const r = await connectOptions({
      renderer: 'foo',
      quality: 'foo',
      'quality-mode': 'foo',
      'progressive-preview': 'foo',
      'camera-mode': 'foo',
      'frame-content': 'foo',
      'interaction-quality': 'foo'
    });
    expect(pick(r)).toEqual({ quality: 'auto' });
    expect(r.mode).toBeUndefined();
    expect(r.cameraMode).toBeUndefined();
  });

  it('case and whitespace matter: "2D" and " 2d" are not the 2d renderer', async () => {
    expect((await connectOptions({ renderer: '2D' })).mode).toBeUndefined();
    expect((await connectOptions({ renderer: ' 2d' })).mode).toBeUndefined();
    expect((await connectOptions({ renderer: '2d' })).mode).toBe('2d');
  });
});
