/**
 * The camera-lens range (DD-032 §4.2), checked in core so that a call made before the on-demand 3D
 * renderer has loaded throws synchronously. Same rule and message as the renderer's own check. Internal:
 * not re-exported.
 */
export function checkCameraFov(fov: number): void {
  if (!(fov >= 10 && fov <= 120)) throw new RangeError(`fov must be in [10, 120] degrees (got ${String(fov)})`);
}
