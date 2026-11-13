// @vitest-environment happy-dom
/**
 * Pinned through the SVELTE `/model` store handle (`createModelViewer`, which `<ModelViewer>` wraps): `capture()`
 * before a canvas is bound rejects with `CaptureUnsupportedError`, and an invalid render scope throws a
 * `RangeError` synchronously from `controls.setRenderScope` and at creation. (The `.svelte` shell itself is
 * covered by the svelte-compat legs.)
 */
import { describe, expect, it } from 'vitest';
import { MODEL_STUB_CONTROLS, MODEL_STUB_GL } from '@chestnutlabs/gcode-model-renderer/testing';
import { CaptureUnsupportedError } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer } from '../model/index';

const opts = { createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS };

describe('svelte createModelViewer: capture and scope validation', () => {
  it('capture before a canvas is bound rejects with CaptureUnsupportedError, via the handle and via controls', async () => {
    const viewer = createModelViewer(opts);
    await expect(viewer.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    await expect(viewer.controls.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    viewer.dispose();
  });

  it('after the canvas is bound the stub renderer still cannot capture: the same error', async () => {
    const viewer = createModelViewer(opts);
    const action = viewer.canvas(document.createElement('canvas'));
    await expect(viewer.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError);
    action.destroy();
    await expect(viewer.capture()).rejects.toBeInstanceOf(CaptureUnsupportedError); // unbound again
    viewer.dispose();
  });

  it('a bad render scope throws RangeError at creation and from setRenderScope; null clears it', () => {
    expect(() => createModelViewer({ ...opts, renderScope: { objectIds: 'nope' } as never })).toThrow(RangeError);
    const viewer = createModelViewer(opts);
    expect(() => viewer.controls.setRenderScope({ plateId: 1.5 })).toThrow(RangeError);
    expect(() => viewer.controls.setRenderScope(null)).not.toThrow();
    viewer.dispose();
  });
});
