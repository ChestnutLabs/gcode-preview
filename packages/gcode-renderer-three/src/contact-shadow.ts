/**
 * Contact shadow (DD-032 §4.1): one soft radial blob decal at plate level under the content footprint.
 * Not shadow maps — deterministic, cheap, identical headless and interactive. A pure builder; the caller
 * picks the footprint (modelBounds → objectBounds → all-extrusion precedence) and owns disposal of the
 * mesh's geometry, material, and its `map`.
 */
import {
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  UnsignedByteType
} from 'three';

/** Footprint in printer XY (mm). */
export interface ShadowFootprint {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

/** Side of the square alpha texture. */
const SHADOW_TEX = 64;
/** The decal spans the footprint × this factor, so the soft falloff reaches past the content edge. */
const SHADOW_SPREAD = 1.4;
/**
 * Fixed decal height: above the plate top (z = −0.05), below the grid and the toolpath (z = 0), so it can
 * never touch first-layer tubes. Not a parameter.
 */
export const CONTACT_SHADOW_Z = -0.04;

/** Radial alpha: 1 at the centre, smoothly to 0 at the inscribed circle, 0 outside. Row 0 = v 0. */
function radialAlpha(): DataTexture {
  const data = new Uint8Array(SHADOW_TEX * SHADOW_TEX * 4);
  const c = (SHADOW_TEX - 1) / 2;
  for (let y = 0; y < SHADOW_TEX; y++) {
    for (let x = 0; x < SHADOW_TEX; x++) {
      const r = Math.min(1, Math.hypot(x - c, y - c) / c);
      const s = 1 - r;
      const i = (y * SHADOW_TEX + x) * 4;
      data[i + 3] = Math.round(255 * s * s * (3 - 2 * s)); // smoothstep falloff; rgb stays black
    }
  }
  const tex = new DataTexture(data, SHADOW_TEX, SHADOW_TEX, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The shadow decal for a footprint, or `null` when there is no content (no footprint, or a footprint
 * with no positive, finite area — a footprint comes from file data, so a non-finite one draws nothing).
 * Named 'contactShadow'. Throws `RangeError` for an `opacity` outside [0,1] (or NaN): that is an option.
 */
export function createContactShadow(footprint: ShadowFootprint | null, opacity: number): Mesh | null {
  if (!(opacity >= 0 && opacity <= 1)) {
    throw new RangeError(`contactShadow opacity must be a number in [0,1] (got ${String(opacity)})`);
  }
  if (footprint === null) return null;
  const w = footprint.max.x - footprint.min.x;
  const h = footprint.max.y - footprint.min.y;
  // A finite w (or h) implies finite min and max (an infinite end makes the difference ±Infinity or NaN),
  // so checking the extent alone also bounds the centre.
  if (!(w > 0 && h > 0 && w < Infinity && h < Infinity)) return null;
  const cx = footprint.min.x + w / 2;
  const cy = footprint.min.y + h / 2;
  const geom = new PlaneGeometry(w * SHADOW_SPREAD, h * SHADOW_SPREAD);
  geom.translate(cx, cy, CONTACT_SHADOW_Z);
  const material = new MeshBasicMaterial({
    color: 0x000000,
    map: radialAlpha(),
    transparent: true,
    opacity,
    side: DoubleSide,
    depthWrite: false
  });
  const mesh = new Mesh(geom, material);
  mesh.name = 'contactShadow';
  // Between the plate top (−1) and the grid (0), so whether grid lines darken inside the shadow never
  // flips as the camera orbits.
  mesh.renderOrder = -0.5;
  return mesh;
}
