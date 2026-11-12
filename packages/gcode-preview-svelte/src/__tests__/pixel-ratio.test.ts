// @vitest-environment happy-dom
/**
 * The Svelte shells' `pixelRatio` prop. There is no component-mount harness here (see
 * prop-reactivity.test.ts), so the `.svelte` wiring is pinned in the source, as for `cameraFov`: an
 * unset-by-default prop, passed at construction, re-applied on change only when defined. The compiler-free
 * `createModelViewer` the model shell wraps is exercised for real.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_STUB_CONTROLS } from '@chestnutlabs/gcode-model-renderer/testing';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import TOOLPATH from '../GcodePreview.svelte?raw';
import MODEL from '../model/ModelViewer.svelte?raw';
import { createModelViewer } from '../model/index';

describe('Svelte <GcodePreview> pixelRatio', () => {
  it('is an unset-by-default prop', () => {
    expect(TOOLPATH).toMatch(/export let pixelRatio = undefined;/);
  });
  it('is passed to the renderer options at construction', () => {
    expect(TOOLPATH).toMatch(/renderer: \{[^}]*\n\s+pixelRatio,\n/);
  });
  it('re-applies on change only when defined', () => {
    expect(TOOLPATH).toMatch(/\$: if \(pixelRatio !== undefined\) preview\.controls\.setPixelRatio\(pixelRatio\);/);
  });
});

describe('Svelte <ModelViewer> pixelRatio', () => {
  it('the shell declares, passes and re-applies the prop', () => {
    expect(MODEL).toMatch(/export let pixelRatio = undefined;/);
    expect(MODEL).toMatch(/createModelViewer\(\{[^}]*\n\s+pixelRatio,\n/);
    expect(MODEL).toMatch(/\$: if \(pixelRatio !== undefined\) viewer\.controls\.setPixelRatio\(pixelRatio\);/);
  });

  it('createModelViewer: the option applies on bind and setPixelRatio follows', () => {
    const ratios: number[] = [];
    const viewer = createModelViewer({
      pixelRatio: 2,
      createRenderer: (c: RenderTargetCanvas): GLRendererLike => ({
        render: () => undefined,
        setSize: () => undefined,
        setPixelRatio: (r) => ratios.push(r),
        dispose: () => undefined,
        domElement: c
      }),
      createControls: MODEL_STUB_CONTROLS
    });
    const action = viewer.canvas(document.createElement('canvas'));
    expect(ratios).toEqual([2]);
    viewer.controls.setPixelRatio(1.5);
    expect(ratios).toEqual([2, 1.5]);
    action.destroy();
    viewer.dispose();
  });
});
