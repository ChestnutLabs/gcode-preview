/**
 * Option checks for the 3D renderer: the one source of truth for every rule, shared by the renderer
 * itself and by `gcode-preview-core`, which runs them synchronously before the on-demand 3D load.
 *
 * **This module never value-imports `three`** (type imports only). It is reached from the three-free
 * `./lite` entry, and `lite-entry.test.ts` walks its module graph to keep it that way.
 *
 * Every check throws `RangeError` naming the option and what it accepts. None of them clamps or
 * coerces. Each enum check exports its allowed values as a `readonly` tuple, so a caller can filter
 * input (an HTML attribute, say) without a try/catch.
 */
import type { BuildVolumeDef } from './build-volume.js';
import type { CameraMode, CameraState, CameraView } from './interactive-stage.js';
import type { ProgressivePreview } from './scene.js';
import type { PixelRatioOption } from './stage.js';
import type { Theme } from './theme.js';
import type { QualityPolicy } from './capability.js';

// ─── Enums ────────────────────────────────────────────────────────────────────────────────────────

/** `'a' or 'b'`, `'a', 'b' or 'c'`: the list phrasing every enum message uses (every list has 2+ names). */
function phrase(allowed: readonly string[]): string {
  const q = allowed.map((a) => `'${a}'`);
  return `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}`;
}

function checkEnum(name: string, value: unknown, allowed: readonly string[]): void {
  if (!allowed.includes(value as string)) {
    throw new RangeError(`${name} must be ${phrase(allowed)} (got ${String(value)})`);
  }
}

/** The camera projections. */
export const CAMERA_MODES = ['perspective', 'orthographic'] as const satisfies readonly CameraMode[];
/** The preset camera views (`setView`). */
export const CAMERA_VIEWS = [
  'top',
  'bottom',
  'front',
  'back',
  'left',
  'right',
  'iso'
] as const satisfies readonly CameraView[];
/** The during-parse preview presentations. */
export const PROGRESSIVE_PREVIEW_MODES = [
  'auto',
  'lines',
  'hold',
  'off'
] as const satisfies readonly ProgressivePreview[];
/** The fidelity policies (`qualityMode`). */
export const QUALITY_POLICIES = ['full', 'adaptive', 'fast'] as const satisfies readonly QualityPolicy[];
/** The framing targets (`frameContent`). */
export const FRAME_CONTENT_MODES = ['object', 'all'] as const;
/** The interaction-quality modes. */
export const INTERACTION_QUALITY_MODES = ['off', 'auto'] as const;
/** The renderer implementations (`renderer.mode` in `gcode-preview-core`). */
export const RENDERER_MODES = ['2d', '3d'] as const;

/** A camera mode must be exactly `'perspective'` or `'orthographic'`. */
export function checkCameraMode(mode: unknown): asserts mode is CameraMode {
  checkEnum('cameraMode', mode, CAMERA_MODES);
}

/** A preset view must be one of {@link CAMERA_VIEWS}. */
export function checkCameraView(view: unknown): asserts view is CameraView {
  checkEnum('view', view, CAMERA_VIEWS);
}

/** `progressivePreview` must be exactly one of the four modes; anything else would silently act like `'hold'`. */
export function checkProgressivePreview(mode: unknown): asserts mode is ProgressivePreview {
  checkEnum('progressivePreview', mode, PROGRESSIVE_PREVIEW_MODES);
}

/** A quality policy must be exactly `'full'`, `'adaptive'` or `'fast'` (no `undefined` here: a setter needs a value). */
export function checkQualityMode(mode: unknown): asserts mode is QualityPolicy {
  checkEnum('qualityMode', mode, QUALITY_POLICIES);
}

/** `frameContent` must be exactly `'object'` or `'all'`. */
export function checkFrameContent(mode: unknown): asserts mode is (typeof FRAME_CONTENT_MODES)[number] {
  checkEnum('frameContent', mode, FRAME_CONTENT_MODES);
}

/** `interactionQuality` must be exactly `'off'` or `'auto'`. */
export function checkInteractionQuality(mode: unknown): asserts mode is (typeof INTERACTION_QUALITY_MODES)[number] {
  checkEnum('interactionQuality', mode, INTERACTION_QUALITY_MODES);
}

/** A renderer mode must be exactly `'2d'` or `'3d'`. */
export function checkRendererMode(mode: unknown): asserts mode is (typeof RENDERER_MODES)[number] {
  checkEnum('renderer.mode', mode, RENDERER_MODES);
}

// ─── Lens ─────────────────────────────────────────────────────────────────────────────────────────

/** A perspective vertical fov must be a number in [10, 120] degrees (extreme lenses put the camera absurdly far/near). */
export function checkCameraFov(fov: number): void {
  if (!(fov >= 10 && fov <= 120)) throw new RangeError(`fov must be in [10, 120] degrees (got ${String(fov)})`);
}

/**
 * A pixel ratio must be `'device'` (the exact string, case-sensitive) or a number in (0, 4]. It never
 * clamps.
 */
export function checkPixelRatio(ratio: PixelRatioOption): void {
  if (ratio === 'device') return;
  if (!(typeof ratio === 'number' && ratio > 0 && ratio <= 4)) {
    throw new RangeError(`pixelRatio must be 'device' or a number in (0, 4] (got ${String(ratio)})`);
  }
}

// ─── Camera state ─────────────────────────────────────────────────────────────────────────────────

const isFiniteVec3 = (v: unknown): boolean => {
  const o = v as { x?: unknown; y?: unknown; z?: unknown } | null | undefined;
  return typeof o === 'object' && o !== null && Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z);
};

/**
 * A restored {@link CameraState} (typically parsed from persisted JSON) must have finite `position` / `target`
 * coordinates, a finite `zoom` > 0 and a valid `cameraMode`, before the camera is touched. A NaN pose would
 * blank the view for good and a garbage mode would wedge the projection state.
 */
export function checkCameraState(state: CameraState): void {
  const s = state as Partial<CameraState> | null | undefined;
  if (typeof s !== 'object' || s === null) throw new RangeError('camera state must be an object');
  checkCameraMode(s.cameraMode);
  if (!isFiniteVec3(s.position)) throw new RangeError('camera state position must be {x, y, z} finite numbers');
  if (!isFiniteVec3(s.target)) throw new RangeError('camera state target must be {x, y, z} finite numbers');
  // `Number.isFinite` does not coerce, so it already rejects strings/undefined/null.
  if (!Number.isFinite(s.zoom) || (s.zoom as number) <= 0) {
    throw new RangeError(`camera state zoom must be a finite number > 0 (got ${String(s.zoom)})`);
  }
}

// ─── Theme ────────────────────────────────────────────────────────────────────────────────────────
// Colour strings are NOT checked here. A theme is a consumer option, so a bad value throws `RangeError`
// instead of reaching three as NaN or a silent fallback.

/** NaN or an out-of-range opacity would render nonsense silently. */
function checkOpacity(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!(value >= 0 && value <= 1)) {
    throw new RangeError(`theme ${name} must be a number in [0,1] (got ${String(value)})`);
  }
}

/** A light intensity or a plate thickness: a finite number, at least 0 (NaN/Infinity would reach three as is). */
function checkNonNegative(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`theme ${name} must be a finite number >= 0 (got ${String(value)})`);
  }
}

/** A named choice: an unknown string (a typo) used to fall back silently to the default. */
function checkOneOf(name: string, value: unknown, allowed: readonly string[]): void {
  if (!allowed.includes(value as string)) {
    throw new RangeError(
      `theme ${name} must be one of ${allowed.map((a) => `'${a}'`).join(', ')} (got ${String(value)})`
    );
  }
}

/**
 * Every numeric / named theme value: an opacity outside [0,1] (or NaN; grid, major, outline, shadow and
 * plate opacities), a non-finite / non-positive `gridMajor.every`, a light intensity or plate `thickness`
 * that is not a finite number of at least 0, or a `materialPreset` / `bedSurface.mode` that is not one of
 * its names. `undefined` (no theme) passes, as it does for `resolveTheme`.
 */
export function checkTheme(theme: Theme | undefined): void {
  const t = theme ?? {};
  checkOpacity('gridOpacity', t.gridOpacity);
  checkOpacity('gridMajor.opacity', t.gridMajor?.opacity);
  checkOpacity('bedOutline.opacity', t.bedOutline?.opacity);
  checkOpacity('contactShadow.opacity', t.contactShadow?.opacity);
  if (t.gridMajor !== undefined && !(Number.isFinite(t.gridMajor.every) && t.gridMajor.every > 0)) {
    throw new RangeError(`theme gridMajor.every must be a positive number (got ${String(t.gridMajor.every)})`);
  }
  checkNonNegative('hemisphereIntensity', t.hemisphereIntensity);
  checkNonNegative('directionalIntensity', t.directionalIntensity);
  if (t.materialPreset !== undefined) checkOneOf('materialPreset', t.materialPreset, ['matte', 'glossy']);
  const s = t.bedSurface;
  if (s !== undefined) {
    checkOneOf('bedSurface.mode', s.mode, ['none', 'solid']);
    checkOpacity('bedSurface.opacity', s.opacity);
    checkNonNegative('bedSurface.thickness', s.thickness);
  }
}

// ─── Build volume ─────────────────────────────────────────────────────────────────────────────────

/**
 * Most grid lines drawn along one axis. A real bed is a few hundred lines at most (1 m at a 1 mm pitch is
 * 1001); 10 000 per axis (20 000 segments in all) is ~10× that, far past any printer, yet small enough to
 * build instantly. It bounds the grid loops BY CONSTRUCTION: the count is computed up front from the
 * extent and pitch, so a huge but finite volume (1e9 mm at a 10 mm pitch ≈ 1e8 lines) throws instead of
 * hanging or running out of memory.
 */
export const MAX_GRID_LINES_PER_AXIS = 10_000;

/**
 * Reject a build volume the grid loops cannot draw: a non-finite or non-positive pitch, a non-finite
 * extent / origin / height, a non-finite bed shape or excluded-region point, or a grid of more than
 * {@link MAX_GRID_LINES_PER_AXIS} lines on an axis. Before this check such a volume (Infinity extent, zero
 * pitch, absurd extent) never returned: the synchronous grid loop ran until memory ran out.
 */
export function checkBuildVolume(def: BuildVolumeDef): void {
  const pitch = def.grid ?? 10;
  if (!(Number.isFinite(pitch) && pitch > 0)) {
    throw new RangeError(`buildVolume.grid must be a positive finite number (got ${String(pitch)})`);
  }
  const fields: [string, number][] = [
    ['x', def.x],
    ['y', def.y],
    ['z', def.z],
    ['min.x', def.min?.x ?? 0],
    ['min.y', def.min?.y ?? 0]
  ];
  for (const [name, v] of fields) {
    if (!Number.isFinite(v)) throw new RangeError(`buildVolume.${name} must be a finite number (got ${String(v)})`);
  }
  for (const [axis, extent] of [
    ['x', def.x],
    ['y', def.y]
  ] as const) {
    const lines = Math.floor(extent / pitch) + 1;
    if (lines > MAX_GRID_LINES_PER_AXIS) {
      throw new RangeError(
        `buildVolume.${axis} of ${extent} mm at a ${pitch} mm grid needs ${lines} grid lines (> ${MAX_GRID_LINES_PER_AXIS} per axis)`
      );
    }
  }
  // The count above is pure arithmetic on the EXTENT; the loops step the ORIGIN. At |origin| ≥ ~2^53·pitch
  // `v + pitch === v`, so a stepping loop never advances (1e20 + 10 === 1e20). Reject that at either edge.
  for (const [axis, lo, hi] of [
    ['x', def.min?.x ?? 0, (def.min?.x ?? 0) + def.x],
    ['y', def.min?.y ?? 0, (def.min?.y ?? 0) + def.y]
  ] as const) {
    if (lo + pitch === lo || hi + pitch === hi) {
      throw new RangeError(
        `buildVolume ${axis} range ${lo}..${hi} is too large for a ${pitch} mm grid (the grid pitch is below the coordinate precision)`
      );
    }
  }
  const shape = def.shape;
  if (shape?.kind === 'circular') {
    for (const v of [shape.center.x, shape.center.y, shape.diameter]) {
      if (!Number.isFinite(v)) throw new RangeError(`buildVolume.shape (circular) must be finite (got ${String(v)})`);
    }
  } else if (shape?.kind === 'polygon') {
    for (const p of shape.points) {
      if (!(Number.isFinite(p.x) && Number.isFinite(p.y))) {
        throw new RangeError(`buildVolume.shape (polygon) points must be finite (got ${String(p.x)}, ${String(p.y)})`);
      }
    }
  }
  for (const region of def.excludedRegions ?? []) {
    for (const p of region.points) {
      if (!(Number.isFinite(p.x) && Number.isFinite(p.y))) {
        throw new RangeError(`buildVolume.excludedRegions points must be finite (got ${String(p.x)}, ${String(p.y)})`);
      }
    }
  }
}
