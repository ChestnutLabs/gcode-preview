// @vitest-environment happy-dom
/**
 * DD-030 D1 — interactive capture. The GL-free halves (row flip, size resolution) are unit-tested here;
 * the unsupported path is verified through `ToolpathRenderer.capture()` with a stub GL that cannot
 * render-to-target. The full pixel path (render-target readback + canvas encode) is browser-only and is
 * validated in the browser, not in Node.
 */
import { describe, expect, it } from 'vitest';
import { SRGBColorSpace } from 'three';
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

describe('capture — includeBuildVolume', () => {
  // A capture-capable stub GL that records the build-volume group's visibility at the moment the
  // scene is rendered INTO the off-screen target (setRenderTarget(non-null) → render). Encoding the
  // pixels is browser-only, so capture may still reject at the encode step — but the render (and the
  // visibility we care about) happens first, and the finally-restore runs regardless.
  function makeProbe(): {
    renderer: ToolpathRenderer;
    capturedVisible: () => boolean | null;
    volumeVisible: () => boolean;
  } {
    const canvas = document.createElement('canvas');
    let toTarget = false;
    let capturedVisible: boolean | null = null;
    // Definite-assignment forward reference: the stub's render closure reads the renderer's
    // volumeGroup lazily, but the renderer is constructed with that stub — assigned once below.
    // eslint-disable-next-line prefer-const
    let renderer!: ToolpathRenderer;
    const volGroup = () => (renderer as unknown as { volumeGroup: { visible: boolean } | null }).volumeGroup;
    const stub: GLRendererLike & {
      setRenderTarget: (t: unknown) => void;
      readRenderTargetPixels: () => void;
    } = {
      render: () => {
        if (toTarget) capturedVisible = volGroup()?.visible ?? null;
      },
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas,
      setRenderTarget: (t) => {
        toTarget = t !== null;
      },
      readRenderTargetPixels: () => undefined
    };
    renderer = new ToolpathRenderer({
      canvas,
      quality: 'lines',
      buildVolume: { x: 220, y: 220, z: 250 },
      createRenderer: () => stub as unknown as GLRendererLike,
      scheduleFrame: () => undefined
    });
    return { renderer, capturedVisible: () => capturedVisible, volumeVisible: () => volGroup()!.visible };
  }

  it('hides the build-volume group for the off-screen render, then restores the live view', async () => {
    const probe = makeProbe();
    await probe.renderer.capture({ includeBuildVolume: false, background: 'transparent' }).catch(() => undefined);
    expect(probe.capturedVisible()).toBe(false); // grid/bed/cage hidden during the capture render
    expect(probe.volumeVisible()).toBe(true); // live view restored — no permanent change
    probe.renderer.dispose();
  });

  it('includes the build-volume group by default', async () => {
    const probe = makeProbe();
    await probe.renderer.capture().catch(() => undefined);
    expect(probe.capturedVisible()).toBe(true); // default: the build volume is part of the capture
    expect(probe.volumeVisible()).toBe(true);
    probe.renderer.dispose();
  });
});

describe('capture — colour space (regression: too-dark thumbnails)', () => {
  it('renders the capture target as sRGB so readback matches the canvas / renderStill', async () => {
    const canvas = document.createElement('canvas');
    let targetColorSpace: string | null = null;
    const stub: GLRendererLike & {
      setRenderTarget: (t: unknown) => void;
      readRenderTargetPixels: () => void;
    } = {
      render: () => undefined,
      setSize: () => undefined,
      dispose: () => undefined,
      domElement: canvas,
      setRenderTarget: (t) => {
        if (t !== null) targetColorSpace = (t as { texture: { colorSpace: string } }).texture.colorSpace;
      },
      readRenderTargetPixels: () => undefined
    };
    const renderer = new ToolpathRenderer({
      canvas,
      quality: 'lines',
      createRenderer: () => stub as unknown as GLRendererLike,
      scheduleFrame: () => undefined
    });
    // Encoding the pixels is browser-only and may reject after the render — but the off-screen render
    // (and the target whose colour space we assert) happens first. A default (linear) target here would
    // make readRenderTargetPixels return too-dark bytes (#6d7176 → ~#272a2e); sRGB matches the canvas.
    await renderer.capture().catch(() => undefined);
    expect(targetColorSpace).toBe(SRGBColorSpace);
    renderer.dispose();
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
