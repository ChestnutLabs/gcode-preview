/**
 * Interactive view capture (DD-030 D1). Turn "what is on screen right now" into an image `Blob` —
 * for a user-selected thumbnail, a large-file fallback, a screenshot, any consumer that needs the
 * currently displayed view. The real capture (render-to-target + readback) lives on `InteractiveStage`
 * where the GL/scene/camera are; this module holds the vendor-neutral option type and the pure,
 * GL-free helpers (row flip, RGBA→Blob encode) so they are unit-testable without a WebGL context.
 *
 * Design (DD-030 D1): capture renders the current scene + active camera into an **off-screen render
 * target** and reads it back, rather than flipping the interactive context's `preserveDrawingBuffer`
 * (which taxes every interactive frame). That gives an arbitrary output size and an independent /
 * transparent background without disturbing the live view, and reuses the headless still path's
 * "single render, then read pixels" recipe. The library returns the `Blob`; it never triggers a
 * download (the caller owns the pixels, same contract as `renderStill`).
 */
import type { ThemeColor } from './theme.js';

/** Thrown when `capture()` cannot run — no render-to-target support (stub GL / no WebGL), or the
 *  stage is disposed / its context is lost. Carries a stable `code` for consumer branching. */
export class CaptureUnsupportedError extends Error {
  readonly code = 'E_CAPTURE_UNSUPPORTED';
  constructor(message: string) {
    super(message);
    this.name = 'CaptureUnsupportedError';
  }
}

/** Options for an interactive view capture. All optional; sensible defaults match the live view. */
export interface CaptureOptions {
  /** Output width in pixels (default: the current drawing-buffer width). */
  width?: number;
  /** Output height in pixels (default: the current drawing-buffer height). */
  height?: number;
  /** Encoded image type (default `'image/png'`). */
  format?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Quality 0..1 for lossy formats (`jpeg`/`webp`); ignored for `png`. */
  quality?: number;
  /** Background for the capture: `'transparent'`, or a solid color. Default: the live scene background. */
  background?: 'transparent' | ThemeColor;
  /**
   * Include the build-volume group (grid + bed surface + origin + cage) in the capture. Default `true`
   * (the live view). Set `false` to exclude it for the off-screen render only — with
   * `background:'transparent'` this yields a clean toolpath-only cutout (parity with `ModelRenderer`
   * thumbnails), without disturbing the live view. Honored by the 3D toolpath renderer; a no-op where
   * there is no build volume (`ModelViewer`) or no capture (the 2D renderer).
   */
  includeBuildVolume?: boolean;
}

/** Resolve the capture pixel size from options + the live drawing-buffer size (both clamped to ≥1). */
export function resolveCaptureSize(opts: CaptureOptions, bufferW: number, bufferH: number): { w: number; h: number } {
  const w = Math.max(1, Math.round(opts.width ?? bufferW));
  const h = Math.max(1, Math.round(opts.height ?? bufferH));
  return { w, h };
}

/**
 * WebGL `readRenderTargetPixels` returns rows bottom-to-top; canvas `ImageData` is top-to-bottom.
 * Return a vertically-flipped copy of the RGBA buffer. Pure — the load-bearing, testable half of capture.
 */
export function flipRowsRGBA(src: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    const from = y * stride;
    const to = (height - 1 - y) * stride;
    out.set(src.subarray(from, from + stride), to);
  }
  return out;
}

/**
 * Encode a top-down RGBA buffer into an image `Blob` via a 2D canvas. Uses `OffscreenCanvas` when
 * available (workers + modern browsers), else a DOM `<canvas>`. Browser/worker only — there is no
 * canvas 2D encoder in bare Node, so this is exercised in the browser, not unit tests.
 */
export async function encodeRGBAToBlob(
  rgba: Uint8Array,
  width: number,
  height: number,
  format: string,
  quality?: number
): Promise<Blob> {
  const canvas = makeCanvas2D(width, height);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx === null) throw new Error('capture: 2D canvas context unavailable');
  const clamped = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  ctx.putImageData(new ImageData(clamped, width, height), 0, 0);
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: format, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('capture: toBlob returned null'))), format, quality);
  });
}

function makeCanvas2D(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}
