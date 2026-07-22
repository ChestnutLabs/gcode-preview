import { MoveKind, type ToolpathBounds, type ToolpathSegments, type Vec3 } from './ir';

export function emptyBounds(): ToolpathBounds {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
}

function expand(b: ToolpathBounds, x: number, y: number, z: number): void {
  if (x < b.min.x) b.min.x = x;
  if (y < b.min.y) b.min.y = y;
  if (z < b.min.z) b.min.z = z;
  if (x > b.max.x) b.max.x = x;
  if (y > b.max.y) b.max.y = y;
  if (z > b.max.z) b.max.z = z;
}

/**
 * Compute bounds over segment endpoints, converting Float32 deltas back to absolute
 * coordinates via `origin`. Returns extrude-only bounds and travel-inclusive bounds.
 */
export function computeSegmentBounds(
  seg: ToolpathSegments,
  origin: Vec3
): { bounds: ToolpathBounds; boundsWithTravel: ToolpathBounds } {
  const bounds = emptyBounds();
  const boundsWithTravel = emptyBounds();
  for (let i = 0; i < seg.count; i++) {
    const sx = origin.x + seg.x0[i];
    const sy = origin.y + seg.y0[i];
    const sz = origin.z + seg.z0[i];
    const ex = origin.x + seg.x1[i];
    const ey = origin.y + seg.y1[i];
    const ez = origin.z + seg.z1[i];
    expand(boundsWithTravel, sx, sy, sz);
    expand(boundsWithTravel, ex, ey, ez);
    if ((seg.kind[i] & MoveKind.Extrude) !== 0) {
      expand(bounds, sx, sy, sz);
      expand(bounds, ex, ey, ez);
    }
  }
  return { bounds, boundsWithTravel };
}
