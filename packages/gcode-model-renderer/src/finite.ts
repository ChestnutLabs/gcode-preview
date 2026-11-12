/**
 * Finite-geometry predicate shared by the STL and 3MF loaders. Model geometry is stored as float32
 * (`Float32Array` positions), so a coordinate is usable only when it is a real number AND fits float32:
 * `NaN`, `±Infinity` and magnitudes beyond float32's range (`1e300` overflows to `Infinity` on store) are not.
 * Same "finite and within float32 range" shape as the G-code parser's stored-position guard.
 */
import { ModelParseError } from './limits.js';
import type { ModelBounds } from './scene-model.js';

/** Largest finite float32. */
export const FLOAT32_MAX = 3.4028234663852886e38;

/** True when `n` is a finite number whose magnitude fits float32 (`NaN` and `±Infinity` are false). */
export function inFloat32Range(n: number): boolean {
  return Math.abs(n) <= FLOAT32_MAX;
}

/**
 * Throw `E_MODEL_PARSE` unless all six bounds values are finite and within float32 range, so fit and
 * placement never consume a `NaN`/`Infinity` box (an all-`NaN` mesh would otherwise give `NaN` bounds).
 */
export function assertFiniteBounds(bounds: ModelBounds, what: string): void {
  for (const v of [...bounds.min, ...bounds.max]) {
    if (!inFloat32Range(v)) {
      throw new ModelParseError('E_MODEL_PARSE', `${what} bounds are not finite float32 values (got ${String(v)})`);
    }
  }
}
