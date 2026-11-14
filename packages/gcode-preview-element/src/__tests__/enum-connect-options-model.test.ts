// @vitest-environment happy-dom
/** What `<gcode-model-viewer>` hands to `createModelPreviewController` at connect for its enum attributes. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import * as model from '@chestnutlabs/gcode-model-renderer';
import { type GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';

vi.mock('@chestnutlabs/gcode-model-renderer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@chestnutlabs/gcode-model-renderer')>();
  return { ...real, createModelPreviewController: vi.fn(real.createModelPreviewController) };
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

async function connectOptions(attrs: Record<string, string>): Promise<Record<string, unknown>> {
  defineGcodeModelViewer();
  const spy = vi.mocked(model.createModelPreviewController);
  spy.mockClear();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-model-viewer') as GcodeModelViewerElement;
  el.createRenderer = () => makeSuiteStubGL(canvas) as never;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await settle();
  el.remove();
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0][0] as Record<string, unknown>;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('<gcode-model-viewer> enum attributes reach the controller as exact literals', () => {
  it('valid values are passed through', async () => {
    const o = await connectOptions({ 'camera-mode': 'orthographic', 'interaction-quality': 'off' });
    expect(o.cameraMode).toBe('orthographic');
    expect(o.interactionQuality).toBe('off');
  });
  it('bad values are not passed at all', async () => {
    for (const bad of ['foo', '', 'Off']) {
      const o = await connectOptions({ 'camera-mode': bad, 'interaction-quality': bad });
      expect('cameraMode' in o).toBe(false);
      expect('interactionQuality' in o).toBe(false);
    }
  });
});
