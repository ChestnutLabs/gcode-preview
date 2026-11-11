/**
 * The camera-lens range (DD-032 §4.2), checked in core so that a call made before the on-demand 3D
 * renderer has loaded throws synchronously. Same rule and message as the renderer's own check. Internal:
 * not re-exported.
 */
export function checkCameraFov(fov: number): void {
  if (!(fov >= 10 && fov <= 120)) throw new RangeError(`fov must be in [10, 120] degrees (got ${String(fov)})`);
}

/**
 * The pixel-ratio rule, checked in core for the same reason (a call before the 3D load throws
 * synchronously): `'device'` exactly, or a number in (0, 4]. Same rule and message as the renderer's.
 * Internal: not re-exported.
 */
export function checkPixelRatio(ratio: number | 'device'): void {
  if (ratio === 'device') return;
  if (!(typeof ratio === 'number' && ratio > 0 && ratio <= 4)) {
    throw new RangeError(`pixelRatio must be 'device' or a number in (0, 4] (got ${String(ratio)})`);
  }
}
