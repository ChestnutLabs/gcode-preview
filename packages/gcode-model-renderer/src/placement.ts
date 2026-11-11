/**
 * Model-viewer plate placement (DD-032 §4.3) — pure and three-free. Given what the source file says about
 * where its parts sit ({@link ModelSceneSource}), the render scope, and the consumer's bed, decide how
 * honestly a build plate can be drawn under the model:
 *
 * - `known`        a Bambu/Orca project whose shown footprint lies on the bed (±1 mm): drawn where authored. A
 *                  file `printable_area` that does not match the consumer's bed (±1 mm per edge) rules out
 *                  `known` and `inferred`.
 * - `inferred`     a Bambu/Orca project whose footprint is off the bed by whole workspace cells: drawn with that
 *                  offset subtracted.
 * - `approximated` anything else (STL, CAD 3MF, PrusaSlicer 3MF, no checks pass): centred on the bed, dropped to z = 0.
 * - `null`         no plate: no bed, nothing shown, or the scope spans more than one declared plate.
 *
 * The offset is presentation-only: `ModelScene` and `getState().bounds` stay authored (DD-025 D3).
 */
import type { ModelBounds, ModelScene, ModelSceneSource, RenderScope } from './scene-model.js';

/** How honestly the model's position on the plate is known (the project's honesty vocabulary). */
export type ModelPlacement = 'known' | 'inferred' | 'approximated';

/** The presentation offset applied to the authored model, mm, printer axes (Z up). */
export interface PlacementOffset {
  x: number;
  y: number;
  z: number;
}

/** A rectangular bed in printer XY (mm). */
export interface PlacementBed {
  min: readonly [number, number];
  max: readonly [number, number];
}

export interface PlacementResult {
  placement: ModelPlacement | null;
  placementOffset: PlacementOffset | null;
}

/** A footprint may overhang the bed by this much and still count as on it. */
export const ON_BED_TOLERANCE_MM = 1;

/**
 * Multi-plate workspace cell = bed size × this. OBSERVED behaviour of exported Bambu/Orca projects
 * (every plate after plate 1 sits one cell over from plate 1, rows stepping −Y), recorded clean-room from exported files:
 * "observed, pending the two-plate fixture" (DD-032 §8). If the fixture contradicts it the `inferred` path
 * changes; `approximated` stays the honest fallback.
 */
export const WORKSPACE_CELL_FACTOR = 1.2;

export const NO_PLACEMENT: PlacementResult = { placement: null, placementOffset: null };

/** A `printable_area` point longer than this is rejected before it is split (no allocation for a huge string). */
const MAX_POINT_CHARS = 64;

/**
 * Read a Bambu/Orca `printable_area` (a JSON array of `"XxY"` strings) as the bed's axis-aligned box.
 * Anything else — not an array, a point longer than 64 characters or not two finite numbers, fewer than three
 * points, or a box with no area — is `undefined` (the file declared no usable bed). No regex: `split('x')` +
 * `Number`.
 */
export function parsePrintableArea(value: unknown): ModelSceneSource['printableArea'] {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of value) {
    if (typeof p !== 'string' || p.length > MAX_POINT_CHARS) return undefined;
    const parts = p.split('x');
    if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '') return undefined;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxX > minX && maxY > minY)) return undefined;
  return { min: [minX, minY], max: [maxX, maxY] };
}

/** The distinct plate ids of the shown placements (empty when the source declares no plate structure). */
function shownPlateIds(shown: ModelScene): Set<number> {
  const ids = new Set<number>();
  for (const o of shown.objects) for (const id of o.plateIds ?? []) ids.add(id);
  return ids;
}

function onBed(b: ModelBounds, dx: number, dy: number, bed: PlacementBed): boolean {
  const t = ON_BED_TOLERANCE_MM;
  return (
    b.min[0] - dx >= bed.min[0] - t &&
    b.min[1] - dy >= bed.min[1] - t &&
    b.max[0] - dx <= bed.max[0] + t &&
    b.max[1] - dy <= bed.max[1] + t
  );
}

/** Whether every edge of `a` is within the on-bed tolerance of the same edge of `b`. */
function edgesWithin(a: PlacementBed, b: PlacementBed): boolean {
  const t = ON_BED_TOLERANCE_MM;
  return (
    Math.abs(a.min[0] - b.min[0]) <= t &&
    Math.abs(a.min[1] - b.min[1]) <= t &&
    Math.abs(a.max[0] - b.max[0]) <= t &&
    Math.abs(a.max[1] - b.max[1]) <= t
  );
}

/**
 * Decide placement for the shown scene. The file's `printable_area` is trusted only when it matches the
 * consumer's bed (every edge within {@link ON_BED_TOLERANCE_MM}); a mismatched file bed is `approximated`.
 * @param full - the whole source (its `source` and declared `plates` describe the file)
 * @param shown - the scene actually drawn (`full` narrowed by `scope`)
 * @param scope - the active render scope, or `null`
 * @param consumerBed - the consumer's `buildVolume` rectangle, or `null` (no plate)
 */
export function computePlacement(
  full: ModelScene,
  shown: ModelScene,
  scope: RenderScope | null,
  consumerBed: PlacementBed | null
): PlacementResult {
  if (consumerBed === null || shown.objects.length === 0) return NO_PLACEMENT;

  // A scope spanning more than one declared plate, or an unscoped multi-plate project, has no single bed.
  if (shownPlateIds(shown).size > 1) return NO_PLACEMENT;
  if (scope === null && (full.plates?.list.length ?? 0) > 1) return NO_PLACEMENT;

  const fb = shown.bounds;
  const slicer = full.source?.slicerProject === 'bambu-orca';
  const printable = full.source?.printableArea;
  // The plate is always drawn on the consumer's bed, so every check and the centring use that bed. The file's
  // `printable_area` is evidence only: a project made for a different bed cannot be `known` on this one.
  const bed = consumerBed;
  const fileBedMatches = printable !== undefined && edgesWithin(printable, bed);

  if (slicer && (printable === undefined || fileBedMatches)) {
    if (onBed(fb, 0, 0, bed)) return { placement: 'known', placementOffset: { x: 0, y: 0, z: 0 } };
    const cellX = (bed.max[0] - bed.min[0]) * WORKSPACE_CELL_FACTOR;
    const cellY = (bed.max[1] - bed.min[1]) * WORKSPACE_CELL_FACTOR;
    const i = Math.round((fb.min[0] + fb.max[0] - bed.min[0] - bed.max[0]) / 2 / cellX);
    const j = Math.round((fb.min[1] + fb.max[1] - bed.min[1] - bed.max[1]) / 2 / cellY);
    if ((i !== 0 || j !== 0) && onBed(fb, i * cellX, j * cellY, bed)) {
      // `0 -` (not unary minus) so a zero axis is +0, never −0.
      return { placement: 'inferred', placementOffset: { x: 0 - i * cellX, y: 0 - j * cellY, z: 0 } };
    }
  }

  return {
    placement: 'approximated',
    placementOffset: {
      x: (bed.min[0] + bed.max[0]) / 2 - (fb.min[0] + fb.max[0]) / 2,
      y: (bed.min[1] + bed.max[1]) / 2 - (fb.min[1] + fb.max[1]) / 2,
      z: 0 - fb.min[2]
    }
  };
}

/** Authored bounds moved by a presentation offset (the bounds the camera frames and the shadow sits under). */
export function presentedBounds(b: ModelBounds, offset: PlacementOffset | null): ModelBounds {
  if (offset === null) return b;
  return {
    min: [b.min[0] + offset.x, b.min[1] + offset.y, b.min[2] + offset.z],
    max: [b.max[0] + offset.x, b.max[1] + offset.y, b.max[2] + offset.z]
  };
}
