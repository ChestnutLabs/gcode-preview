// @vitest-environment happy-dom
/**
 * DD-030 D1 — interactive capture. The GL-free halves (row flip, size resolution) are unit-tested here;
 * the unsupported path is verified through `ToolpathRenderer.capture()` with a stub GL that cannot
 * render-to-target. The full pixel path (render-target readback + canvas encode) is browser-only and is
 * validated in the browser, not in Node.
 */
import { describe, expect, it } from 'vitest';
import { ToolpathRenderer, type GLRendererLike } from '../index.js';
import { flipRowsRGBA, resolveCaptureSize } from '../capture.js';

describe('capture — pure helpers', () => {
  it('flipRowsRGBA flips rows top↔bottom (2 rows, 1px each)', () => {
    const src = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // row0 = 1..4, row1 = 5..8
    const out = flipRowsRGBA(src, 1, 2);
    expect(Array.from(out)).toEqual([5, 6, 7, 8, 1, 2, 3, 4]); // rows swapped
  });

  it('flipRowsRGBA is a no-op for a single row', () => {
    const src = new Uint8Array([9, 8, 7, 6]);
    expect(Array.from(flipRowsRGBA(src, 1, 1))).toEqual([9, 8, 7, 6]);
  });

  it('resolveCaptureSize defaults to the buffer size, honors overrides, rounds and clamps to ≥1', () => {
    expect(resolveCaptureSize({}, 800, 600)).toEqual({ w: 800, h: 600 });
    expect(resolveCaptureSize({ width: 256 }, 800, 600)).toEqual({ w: 256, h: 600 });
    expect(resolveCaptureSize({ width: 100.6, height: 50.2 }, 800, 600)).toEqual({ w: 101, h: 50 });
    expect(resolveCaptureSize({ width: 0, height: -5 }, 800, 600)).toEqual({ w: 1, h: 1 });
  });
});

describe('capture — unsupported path', () => {
  it('rejects with E_CAPTURE_UNSUPPORTED when the renderer cannot render-to-target', async () => {
    const canvas = document.createElement('canvas');
    const stub: GLRendererLike = {
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas
      // no setRenderTarget / readRenderTargetPixels — a stub GL cannot capture
    };
    const renderer = new ToolpathRenderer({
      canvas,
      quality: 'lines',
      createRenderer: () => stub,
      scheduleFrame: () => undefined
    });
    await expect(renderer.capture()).rejects.toMatchObject({ code: 'E_CAPTURE_UNSUPPORTED' });
    renderer.dispose();
  });
});
