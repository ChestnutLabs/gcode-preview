/**
 * The literal values the element's enum attributes accept (exact, case-sensitive).
 *
 * Markup is like file data: an invalid attribute value is ignored (the default at connect, the last
 * value on a change) and never throws or kills the renderer. A bad PROPERTY is a consumer option, so
 * the property setters throw `RangeError` via {@link assertEnum}. Each list is pinned to the renderer
 * type union it mirrors by a compile-time check, so they cannot drift (a missing or extra member fails `tsc`).
 */
import type { RendererMode } from '@chestnutlabs/gcode-preview-core';
import type {
  CameraMode,
  CameraView,
  ProgressivePreview,
  QualityMode,
  QualityPolicy
} from '@chestnutlabs/gcode-renderer-three';

/** `true` only when the list `L` holds exactly the members of the union `U` (none missing, none extra). */
type Covers<U extends string, L extends string> = [Exclude<U, L>, Exclude<L, U>] extends [never, never] ? true : never;

export const QUALITIES = ['auto', 'lines', 'tubes'] as const;
export const QUALITY_MODES = ['full', 'adaptive', 'fast'] as const;
export const PROGRESSIVE_PREVIEWS = ['auto', 'lines', 'hold', 'off'] as const;
export const CAMERA_MODES = ['perspective', 'orthographic'] as const;
export const FRAME_CONTENTS = ['object', 'all'] as const;
export const INTERACTION_QUALITIES = ['off', 'auto'] as const;
export const RENDERERS = ['2d', '3d'] as const;
export const CAMERA_VIEWS = ['top', 'bottom', 'front', 'back', 'left', 'right', 'iso'] as const;

// Compile-time pins (type-only; erased at runtime).
export const ENUM_PINS: [
  Covers<QualityMode | 'auto', (typeof QUALITIES)[number]>,
  Covers<QualityPolicy, (typeof QUALITY_MODES)[number]>,
  Covers<ProgressivePreview, (typeof PROGRESSIVE_PREVIEWS)[number]>,
  Covers<CameraMode, (typeof CAMERA_MODES)[number]>,
  Covers<RendererMode, (typeof RENDERERS)[number]>,
  Covers<CameraView, (typeof CAMERA_VIEWS)[number]>
] = [true, true, true, true, true, true];

/** `value` if it is exactly one of `list`, else `undefined` (a markup value: ignored, never thrown). */
export function pickEnum<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return (list as readonly (string | null)[]).includes(value) ? (value as T) : undefined;
}

/** A property value must be `null` (clears) or one of `list`; anything else throws `RangeError`, before any reflect. */
export function assertEnum(name: string, list: readonly string[], value: string | null): void {
  if (value !== null && !list.includes(value)) {
    throw new RangeError(`${name} must be ${list.map((v) => `'${v}'`).join(', ')} (got ${String(value)})`);
  }
}
