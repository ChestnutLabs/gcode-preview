/**
 * Gradient scene background (DD-032 §4.1). A pure builder: a 1×N sRGB `DataTexture` ramp (no canvas, so
 * it works in workers and headless stills) that the scene assigns to `scene.background` and disposes on
 * theme change. The caller owns the returned handle and must call `dispose()`.
 */
import { Color, DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import type { ThemeColor } from './theme.js';

/** Rows in the ramp: plenty for a smooth vertical gradient once linearly filtered. */
const RAMP_ROWS = 256;

export interface Backdrop {
  texture: DataTexture;
  dispose(): void;
}

/** sRGB bytes of a theme color (three's `getHex()` reports sRGB under color management). */
function srgbBytes(c: ThemeColor): [number, number, number] {
  const hex = new Color(c).getHex();
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/**
 * A vertical gradient, interpolated in sRGB like a CSS gradient. DataTexture row 0 is the BOTTOM of the
 * texture (v = 0; `flipY` does not apply), so the ramp is stored bottom → top: the first row is exactly
 * `bottom`, the last row exactly `top`.
 */
export function createBackdrop(gradient: { top: ThemeColor; bottom: ThemeColor }): Backdrop {
  const bottom = srgbBytes(gradient.bottom);
  const top = srgbBytes(gradient.top);
  const data = new Uint8Array(RAMP_ROWS * 4);
  for (let row = 0; row < RAMP_ROWS; row++) {
    const t = row / (RAMP_ROWS - 1);
    for (let ch = 0; ch < 3; ch++) data[row * 4 + ch] = Math.round(bottom[ch] + (top[ch] - bottom[ch]) * t);
    data[row * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, 1, RAMP_ROWS, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, dispose: () => texture.dispose() };
}
