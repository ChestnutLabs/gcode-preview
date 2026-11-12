// @vitest-environment happy-dom
/**
 * Model viewer pixel ratio: the `pixelRatio` option + `setPixelRatio` on the engine and the controller,
 * synchronous validation (even before a canvas binds), and the ratio remembered across rebinds. The stage
 * behaviour itself (rebase, 'device', capture size) is covered in gcode-renderer-three. Literal values.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { ControlsLike, GLRendererLike, PixelRatioOption } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer } from '../model-viewer.js';
import { createModelPreviewController } from '../model-preview.js';

function stubControls(camera: ControlsLike['object']): ControlsLike {
  return {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => undefined,
    dispose: () => undefined,
    addEventListener: () => undefined,
    listenToKeyEvents: () => undefined
  };
}

/** Each created GL's ratio log, in creation order. */
function glFactory() {
  const gls: number[][] = [];
  const createRenderer = (canvas: HTMLCanvasElement | OffscreenCanvas): GLRendererLike => {
    const ratios: number[] = [];
    gls.push(ratios);
    return {
      render: () => undefined,
      setSize: () => undefined,
      setPixelRatio: (r) => ratios.push(r),
      dispose: () => undefined,
      domElement: canvas
    };
  };
  return { gls, createRenderer };
}

const errorName = (fn: () => void): string => {
  try {
    fn();
    return 'none';
  } catch (e) {
    return (e as Error).name;
  }
};

describe('model viewer pixelRatio', () => {
  it('the option reaches the stage; setPixelRatio applies live; unset never sets one', () => {
    const f = glFactory();
    const v = createModelViewer(document.createElement('canvas'), {
      createRenderer: f.createRenderer,
      createControls: stubControls,
      pixelRatio: 2
    });
    expect(f.gls[0]).toEqual([2]);
    v.setPixelRatio(1.5);
    expect(f.gls[0]).toEqual([2, 1.5]);
    v.dispose();
    const g = glFactory();
    createModelViewer(document.createElement('canvas'), {
      createRenderer: g.createRenderer,
      createControls: stubControls
    }).dispose();
    expect(g.gls[0]).toEqual([]);
  });

  it('rejects anything outside (0, 4] / exactly "device", at construction (before any GL) and live', () => {
    for (const bad of [0, -1, 4.0001, NaN, 'Device', ' device']) {
      const f = glFactory();
      const err = errorName(() =>
        createModelViewer(document.createElement('canvas'), {
          createRenderer: f.createRenderer,
          createControls: stubControls,
          pixelRatio: bad as PixelRatioOption
        })
      );
      expect(err).toBe('RangeError');
      expect(f.gls).toEqual([]);
    }
    const f = glFactory();
    const v = createModelViewer(document.createElement('canvas'), {
      createRenderer: f.createRenderer,
      createControls: stubControls
    });
    expect(errorName(() => v.setPixelRatio(4.0001))).toBe('RangeError');
    expect(errorName(() => v.setPixelRatio(0))).toBe('RangeError');
    expect(errorName(() => v.setPixelRatio(4))).toBe('none');
    expect(errorName(() => v.setPixelRatio('device'))).toBe('none');
    expect(f.gls[0]![0]).toBe(4);
    v.dispose();
  });

  it('still validates the setter when WebGL is unavailable (no stage to do it)', () => {
    const v = createModelViewer(document.createElement('canvas'), {
      createRenderer: () => {
        throw new Error('no WebGL2');
      },
      createControls: stubControls
    });
    expect(errorName(() => v.setPixelRatio(0))).toBe('RangeError');
    expect(errorName(() => v.setPixelRatio(2))).toBe('none');
    v.dispose();
  });
});

describe('model preview controller pixelRatio', () => {
  it('validates synchronously before a canvas binds, and at creation', () => {
    const c = createModelPreviewController({});
    expect(errorName(() => c.controls.setPixelRatio(0))).toBe('RangeError');
    expect(errorName(() => c.controls.setPixelRatio(4.0001))).toBe('RangeError');
    expect(errorName(() => createModelPreviewController({ pixelRatio: 5 }))).toBe('RangeError');
    expect(errorName(() => createModelPreviewController({ pixelRatio: 'Device' as PixelRatioOption }))).toBe(
      'RangeError'
    );
    c.dispose();
  });

  it('a ratio set before binding applies on bind, live after, and is remembered across a rebind', () => {
    const f = glFactory();
    const c = createModelPreviewController({ createRenderer: f.createRenderer, createControls: stubControls });
    c.controls.setPixelRatio(1.5);
    c.bindCanvas(document.createElement('canvas'));
    expect(f.gls[0]).toEqual([1.5]);
    c.controls.setPixelRatio(2);
    expect(f.gls[0]).toEqual([1.5, 2]);
    expect(errorName(() => c.controls.setPixelRatio(5))).toBe('RangeError'); // does not replace it
    c.bindCanvas(null);
    c.bindCanvas(document.createElement('canvas'));
    expect(f.gls[1]).toEqual([2]);
    c.dispose();
  });

  it('the creation option applies on bind', () => {
    const f = glFactory();
    const c = createModelPreviewController({
      createRenderer: f.createRenderer,
      createControls: stubControls,
      pixelRatio: 3
    });
    c.bindCanvas(document.createElement('canvas'));
    expect(f.gls[0]).toEqual([3]);
    c.dispose();
  });
});
