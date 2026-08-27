/**
 * Non-model geometry classification (DD-026 D4/D5/D7).
 *
 * A pure, O(segments) pass that decides which extrusion is the **printed model** and which is slicer
 * housekeeping (skirt, brim, raft, support, prime/wipe tower, purge, wipe), then reports the model's
 * bounding box (`modelBounds`) and a confidence (`nonModelClassification`). It reads only the settled
 * `kind` / `feature` / `object` channels — no geometry, no source, no allocation beyond one bounds
 * accumulator — so it is safe to run at parse time and again after dialect annotation settles the
 * channels (`gcode-dialects` runner finalize), where it becomes authoritative.
 *
 * Honesty model (DD-026 D7): membership is the only `known`-grade signal because it labels each
 * segment's identity explicitly; role-only exclusion is `inferred` (an unmarked prime line could still
 * be counted as model); nothing excludable at all is `unavailable` and yields empty bounds — never a
 * guess. This deliberately under-claims a bracket-only file as `inferred` rather than `known`, the
 * safe direction: without per-segment membership we cannot rule out other unmarked housekeeping.
 */
import { FeatureRole, MoveKind, type Confidence, type ToolpathBounds, type ToolpathSegments, type Vec3 } from './ir.js';
import { emptyBounds } from './bounds.js';

/**
 * Feature roles excluded from the model (DD-026 D4 rule 4). Towers/raft/purge and the perimeter-adjacent
 * skirt/brim/support are housekeeping; the generic `Custom` role stays in-frame (an unmapped token is
 * kept as model rather than wrongly excluded — the safe direction, RR-007 §7).
 */
export const HOUSEKEEPING_ROLES: ReadonlySet<number> = new Set<number>([
  FeatureRole.Skirt,
  FeatureRole.Brim,
  FeatureRole.Support,
  FeatureRole.Raft,
  FeatureRole.PrimeTower,
  FeatureRole.WipeTower,
  FeatureRole.Purge
]);

/** True when the feature-role index is one the model-bounds classifier excludes (DD-026 D4). */
export function isHousekeepingRole(role: number): boolean {
  return HOUSEKEEPING_ROLES.has(role);
}

/** An extrusion segment is housekeeping if it carries an excluded role or is a wipe move. */
function isHousekeepingSegment(seg: ToolpathSegments, i: number): boolean {
  return isHousekeepingRole(seg.feature[i]) || (seg.kind[i] & MoveKind.Wipe) !== 0;
}

export interface ModelClassification {
  /** Bounds of the classified model extrusion; empty (Infinity/-Infinity) when unknowable. */
  modelBounds: ToolpathBounds;
  /** Confidence that `modelBounds` reflects the printed model (DD-026 D7). */
  classification: Confidence;
}

/**
 * Classify extrusion into model vs. housekeeping and return the model bounds + confidence (DD-026 D4).
 *
 * Precedence per extrusion segment:
 *  1. explicit housekeeping role / wipe → excluded (beats membership: a tower inside an open object
 *     bracket is still a tower, RR-007 §8 rule 1);
 *  2. with a membership channel, `object == 0` → excluded (not a member — catches an unmarked prime);
 *  3. with a membership channel, `object != 0` → model;
 *  4. without a membership channel, anything not excluded by rule 1 → model (role fallback).
 *
 * Confidence: `known` when a membership channel drove it; `inferred` when only role exclusion applied;
 * `unavailable` (empty bounds) when there was neither membership nor any excludable role — the file is
 * genuinely unclassifiable and framing must fall back + disclose.
 */
export function classifyModelBounds(seg: ToolpathSegments, origin: Vec3): ModelClassification {
  let hasMembership = false;
  let hasExcludableRole = false;
  for (let i = 0; i < seg.count; i++) {
    if ((seg.kind[i] & MoveKind.Extrude) === 0) continue;
    if (seg.object[i] !== 0) hasMembership = true;
    if (isHousekeepingSegment(seg, i)) hasExcludableRole = true;
  }

  const classification: Confidence = hasMembership ? 'known' : hasExcludableRole ? 'inferred' : 'unavailable';
  const modelBounds = emptyBounds();
  if (classification === 'unavailable') return { modelBounds, classification };

  const b = modelBounds;
  for (let i = 0; i < seg.count; i++) {
    if ((seg.kind[i] & MoveKind.Extrude) === 0) continue;
    if (isHousekeepingSegment(seg, i)) continue; // rule 1
    if (hasMembership && seg.object[i] === 0) continue; // rule 2 (rule 3 keeps members through)
    const sx = origin.x + seg.x0[i];
    const sy = origin.y + seg.y0[i];
    const sz = origin.z + seg.z0[i];
    const ex = origin.x + seg.x1[i];
    const ey = origin.y + seg.y1[i];
    const ez = origin.z + seg.z1[i];
    if (sx < b.min.x) b.min.x = sx;
    if (sy < b.min.y) b.min.y = sy;
    if (sz < b.min.z) b.min.z = sz;
    if (sx > b.max.x) b.max.x = sx;
    if (sy > b.max.y) b.max.y = sy;
    if (sz > b.max.z) b.max.z = sz;
    if (ex < b.min.x) b.min.x = ex;
    if (ey < b.min.y) b.min.y = ey;
    if (ez < b.min.z) b.min.z = ez;
    if (ex > b.max.x) b.max.x = ex;
    if (ey > b.max.y) b.max.y = ey;
    if (ez > b.max.z) b.max.z = ez;
  }
  return { modelBounds, classification };
}
