/**
 * Build-volume visualization (DD-004 §4.2/§6.2, phase 2).
 *
 * Printer-coordinate space (Z-up; the scene root applies the Y-up rotation once):
 * a floor grid at z=0 spanning [0..x]×[0..y] — cartesian-printer convention, the
 * bed origin is the CORNER, matching the G-code coordinates the toolpath renders
 * at — a wireframe box of the volume, and an origin marker at printer (0,0,0).
 */
import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  type Texture
} from 'three';
import type { Point2, Region2 } from '@chestnutlabs/toolpath-core';
import type { BedSurface, ThemeBedOutline, ThemeColor, ThemeGridMajor } from './theme.js';
import { checkBuildVolume, MAX_GRID_LINES_PER_AXIS } from './validate.js';

/**
 * The bed's true outline (DD-030 D3). Omitted (or `'rect'`) ⇒ the rectangular `[min .. min+size]` bed —
 * byte-identical to the pre-DD-030 renderer. `circular`/`polygon` draw an honest non-rectangular bed
 * (delta/round/irregular): the renderer polygonizes a circle, fills the outline, and clips the grid to
 * it. `MachineGeometry.bed` maps straight onto this (a `mesh` escape hatch is reserved, not yet shipped).
 */
export type BedShape =
  | { kind: 'rect' }
  | { kind: 'circular'; center: Point2; diameter: number }
  | { kind: 'polygon'; points: Point2[] };

export interface BuildVolumeDef {
  x: number;
  y: number;
  z: number;
  /** Grid pitch in mm (default 10). */
  grid?: number;
  /** Bed minimum corner in printer coordinates (default 0,0 — DD-005 §4.2 machines may offset). */
  min?: { x: number; y: number };
  /** Excluded regions to outline on the plate (#185), when known from `MachineGeometry`. */
  excludedRegions?: Region2[];
  /** Non-rectangular bed outline (DD-030 D3). Omit for a rectangular bed (default, byte-identical). */
  shape?: BedShape;
}

/** Themed styling (DD-009 D4, #153). Omitted fields keep the original constants; the
 *  origin tripod (semantic RGB axes) is never themed. */
export interface BuildVolumeStyle {
  gridColor?: ThemeColor;
  gridOpacity?: number;
  boxColor?: ThemeColor;
  boxOpacity?: number;
  /** Build-plate surface (#185); default `{ mode: 'none' }` (bare grid). */
  bedSurface?: BedSurface;
  /**
   * Show the full build-volume wireframe **cage** (the box up to `def.z`). Default `true`. When
   * `false`, only the bed/plate (grid + surface + origin) shows — the cage is decoupled from the plate
   * (#306/#6), so a consumer can present the printable bed without the whole machine volume.
   */
  showCage?: boolean;
  /**
   * Major grid tier (DD-032). `every` snaps to whole minor pitches: every k-th minor line (by integer
   * index from the bed minimum, k = max(1, round(every / grid))) is drawn as a major line instead. So
   * `every: 50` on a 15 mm grid gives majors every 45 mm, and a grid-pitch change never throws.
   * Omit for one tier.
   */
  gridMajor?: ThemeGridMajor;
  /**
   * Bed boundary loop for every shape, rect included (DD-032), drawn above the grid. When set, grid lines
   * lying on the bed edge and the cage's floor edges are not drawn: the outline replaces them. Omit: no
   * loop on rect beds, today's grid-colored loop (opacity +0.3) on non-rect beds.
   */
  bedOutline?: ThemeBedOutline;
}

/** Draw order (DD-032): slab walls, then the plate top, then the grid (default 0), then the outline. */
const ORDER_BED_EDGE = -2;
const ORDER_BED_TOP = -1;
const ORDER_OUTLINE = 1;

function lines(positions: number[], color: ThemeColor, opacity = 1): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new LineSegments(geometry, material);
}

/**
 * Free everything a build-volume group (or any plate-level group) owns: each object's geometry, its
 * material(s), and each material's `map` (three's `material.dispose()` does not free textures, so the
 * bed texture used to leak on every rebuild).
 */
export function disposeBuildVolume(group: Object3D): void {
  group.traverse((obj) => {
    const o = obj as { geometry?: BufferGeometry; material?: Material | Material[] };
    o.geometry?.dispose();
    const mats = o.material === undefined ? [] : Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      (m as Material & { map?: Texture | null }).map?.dispose();
      m.dispose();
    }
  });
}

/**
 * Build the volume group. Caller owns disposal ({@link disposeBuildVolume}). Throws `RangeError` for a
 * volume that cannot be drawn (see `checkBuildVolume`).
 */
export function createBuildVolume(def: BuildVolumeDef, style?: BuildVolumeStyle): Group {
  checkBuildVolume(def);
  const group = new Group();
  group.name = 'buildVolume';
  const gridColor = style?.gridColor ?? 0x448844;
  const gridOpacity = style?.gridOpacity ?? 0.35;
  const boxColor = style?.boxColor ?? 0x888888;
  const boxOpacity = style?.boxOpacity ?? 0.5;
  const pitch = def.grid ?? 10;
  const x0 = def.min?.x ?? 0;
  const y0 = def.min?.y ?? 0;
  const x1 = x0 + def.x;
  const y1 = y0 + def.y;
  const major = style?.gridMajor;
  const edged = style?.bedOutline !== undefined;
  // Every k-th grid line by INTEGER index (k = 0, step, 2·step…) belongs to the major tier and is NOT
  // also drawn as minor — no float comparison of positions.
  let majorStep = 0;
  if (major !== undefined) {
    if (!(Number.isFinite(major.every) && major.every > 0)) {
      throw new RangeError(`gridMajor.every must be a positive number (got ${String(major.every)})`);
    }
    majorStep = Math.max(1, Math.round(major.every / pitch));
  }
  // No major tier ⇒ majorStep 0 ⇒ `k % 0` is NaN, never === 0, so every line is minor without a guard.
  const tierOf = (k: number): 'major' | 'minor' => (k % majorStep === 0 ? 'major' : 'minor');
  // With an outline set, a rect grid line ON the bed edge is left to the outline (no double blend).
  const onEdge = (v: number, lo: number, hi: number): boolean =>
    edged && (Math.abs(v - lo) < 1e-6 || Math.abs(v - hi) < 1e-6);

  // The bed outline (DD-030 D3). `null` ⇒ rectangular: every branch below takes its original,
  // byte-identical path. A non-null polygon ⇒ a delta/round/irregular bed to fill, outline, and clip to.
  const outline = bedOutlinePoints(def);

  // Filled build-plate surface (#185), UNDER the grid so grid lines read on top. A single unlit
  // plane/shape spanning the bed; drawn slightly below z=0 to avoid z-fighting the grid and the first
  // layer. `mode:'none'` (default) skips it entirely — the bare-grid look is unchanged.
  const surface = style?.bedSurface;
  if (surface && surface.mode === 'solid') {
    if ((surface.thickness ?? 0) > 0) {
      const ring: Point2[] = outline ?? [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 }
      ];
      group.add(bedEdgeWalls(ring, surface));
    }
    group.add(outline ? bedShapeMesh(outline, surface) : bedPlate(x0, y0, x1, y1, surface));
  }

  if (outline) {
    // Non-rectangular bed: draw only the grid lines inside the outline, plus the outline itself, so the
    // printable area reads honestly (a round bed is not a square with a circle drawn on it).
    const minorLines = clipGridToPolygon(x0, y0, x1, y1, pitch, outline, tierOf, 'minor', edged);
    group.add(lines(minorLines, gridColor, gridOpacity));
    if (major !== undefined) {
      const majorLines = clipGridToPolygon(x0, y0, x1, y1, pitch, outline, tierOf, 'major', edged);
      group.add(namedLines(majorLines, major.color ?? gridColor, major.opacity, 'gridMajor'));
    }
    const o = style?.bedOutline;
    group.add(
      o !== undefined
        ? bedOutlineLoop(outline, o.color ?? gridColor, o.opacity, ORDER_OUTLINE, true)
        : bedOutlineLoop(outline, gridColor, Math.min(1, gridOpacity + 0.3))
    );
  } else {
    // Rectangular bed at z=0 spanning [min..min+size]: the bed occupies the same coordinates the G-code
    // (and the toolpath) uses. Unchanged from before DD-030 — byte-identical.
    const grid: number[] = [];
    const majorGrid: number[] = [];
    let k = 0;
    for (let i = 0, gx = x0; i <= MAX_GRID_LINES_PER_AXIS && gx <= x1 + 1e-6; i++, gx += pitch) {
      const tier = tierOf(k++);
      if (!onEdge(gx, x0, x1)) (tier === 'major' ? majorGrid : grid).push(gx, y0, 0, gx, y1, 0);
    }
    k = 0;
    for (let i = 0, gy = y0; i <= MAX_GRID_LINES_PER_AXIS && gy <= y1 + 1e-6; i++, gy += pitch) {
      const tier = tierOf(k++);
      if (!onEdge(gy, y0, y1)) (tier === 'major' ? majorGrid : grid).push(x0, gy, 0, x1, gy, 0);
    }
    group.add(lines(grid, gridColor, gridOpacity));
    if (major !== undefined) group.add(namedLines(majorGrid, major.color ?? gridColor, major.opacity, 'gridMajor'));
    const o = style?.bedOutline;
    if (o !== undefined) {
      const rect = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 }
      ];
      group.add(bedOutlineLoop(rect, o.color ?? gridColor, o.opacity, ORDER_OUTLINE, true));
    }
  }

  // Volume wireframe box.
  const z = def.z;
  const box: number[] = [];
  const corners: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ];
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % 4];
    if (!edged) box.push(x1, y1, 0, x2, y2, 0); // floor edges (a set outline replaces them)
    box.push(x1, y1, z, x2, y2, z); // top edges
    box.push(x1, y1, 0, x1, y1, z); // verticals
  }
  // Named + independently visible (#306/#6): the cage is decoupled from the plate, default on.
  const cage = lines(box, boxColor, boxOpacity);
  cage.name = 'volumeCage';
  cage.visible = style?.showCage ?? true;
  group.add(cage);

  // Excluded-region outlines (#185): keep-out zones the machine reports (`MachineGeometry`),
  // drawn just above the plate so they read against it. Amber, semi-opaque; informational only.
  for (const region of def.excludedRegions ?? []) {
    const loop = excludedRegionOutline(region);
    if (loop) group.add(loop);
  }

  // Origin marker at printer (0,0,0): a small tripod.
  const m = Math.max(2, pitch / 2);
  group.add(lines([0, 0, 0, m, 0, 0], 0xcc4444));
  group.add(lines([0, 0, 0, 0, m, 0], 0x44cc44));
  group.add(lines([0, 0, 0, 0, 0, m], 0x4444cc));

  return group;
}

function namedLines(positions: number[], color: ThemeColor, opacity: number, name: string): LineSegments {
  const l = lines(positions, color, opacity);
  l.name = name;
  return l;
}

/**
 * The side walls of a thick plate (DD-032): unlit quads from the top face (z = −0.05) down by
 * `thickness`, along the bed ring, in `edgeColor`. No bottom face (DoubleSide walls; from below the top
 * face shows as before). Drawn before the top face (renderOrder −2 vs −1) so it never paints over it.
 */
function bedEdgeWalls(ring: Point2[], surface: BedSurface): Mesh {
  const zTop = -0.05;
  const zBot = zTop - (surface.thickness ?? 0);
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    pos.push(a.x, a.y, zTop, b.x, b.y, zTop, b.x, b.y, zBot);
    pos.push(a.x, a.y, zTop, b.x, b.y, zBot, a.x, a.y, zBot);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const material = new MeshBasicMaterial({
    color: surface.edgeColor ?? surface.color ?? 0x2a2f3a,
    opacity: surface.opacity ?? 1,
    transparent: (surface.opacity ?? 1) < 1,
    side: DoubleSide,
    depthWrite: false
  });
  const mesh = new Mesh(geom, material);
  mesh.name = 'bedSurfaceEdge';
  mesh.renderOrder = ORDER_BED_EDGE;
  return mesh;
}

/** A filled, unlit plate spanning the bed, drawn just below z=0. Named 'bedSurface' for lookup/tests. */
function bedPlate(x0: number, y0: number, x1: number, y1: number, surface: BedSurface): Mesh {
  const w = x1 - x0;
  const h = y1 - y0;
  const geom = new PlaneGeometry(w, h);
  // PlaneGeometry is centered at the origin in its local XY plane; translate to the bed center.
  geom.translate(x0 + w / 2, y0 + h / 2, -0.05);
  const material = new MeshBasicMaterial({
    color: surface.color ?? 0x2a2f3a,
    opacity: surface.opacity ?? 1,
    transparent: (surface.opacity ?? 1) < 1,
    side: DoubleSide,
    depthWrite: false // a backdrop: never occlude the toolpath even if float error puts a segment at z≈0
  });
  if (surface.texture) {
    const tex = new CanvasTexture(surface.texture);
    tex.colorSpace = SRGBColorSpace; // a colour image: sample it as sRGB, not linear (#462)
    material.map = tex;
    material.needsUpdate = true;
  }
  const mesh = new Mesh(geom, material);
  mesh.name = 'bedSurface';
  mesh.renderOrder = ORDER_BED_TOP; // behind everything but the slab walls
  return mesh;
}

/** Number of segments a circular bed is polygonized into (smooth enough at plate scale). */
const CIRCLE_SEGMENTS = 96;

/**
 * The bed outline as a closed polygon in printer XY, or `null` for a rectangular bed (the caller then
 * takes the original rectangular path — byte-identical). A circle is polygonized; a polygon bed is used
 * as-is (needs ≥3 points, else `null` → falls back to the rectangle honestly).
 */
function bedOutlinePoints(def: BuildVolumeDef): Point2[] | null {
  const shape = def.shape;
  if (!shape || shape.kind === 'rect') return null;
  if (shape.kind === 'circular') {
    const r = shape.diameter / 2;
    const pts: Point2[] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      pts.push({ x: shape.center.x + r * Math.cos(a), y: shape.center.y + r * Math.sin(a) });
    }
    return pts;
  }
  // polygon
  if (shape.points.length < 3) return null;
  return shape.points.map((p) => ({ x: p.x, y: p.y }));
}

/** Whether (x, y) lies on one of the polygon's edges (within 1e-6 mm). */
function onPolygonEdge(x: number, y: number, poly: Point2[]): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j].x;
    const ay = poly[j].y;
    const dx = poly[i].x - ax;
    const dy = poly[i].y - ay;
    const len2 = dx * dx + dy * dy;
    // A zero-length edge (a repeated point) needs no skip: 0 / 0 is NaN, so the distance below is NaN and
    // `NaN < 1e-6` is false (x, y are finite grid midpoints).
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    if (Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) < 1e-6) return true;
  }
  return false;
}

/** Ray-cast point-in-polygon (handles convex and concave outlines). */
function pointInPolygon(x: number, y: number, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Clip the rectangular grid to the bed outline: for each grid line, keep only the sub-segments whose
 * midpoint lies inside the polygon. Handles concave outlines. Returns flat `LineSegments` positions.
 */
function clipGridToPolygon(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pitch: number,
  poly: Point2[],
  tierOf: (k: number) => 'major' | 'minor',
  tier: 'major' | 'minor',
  skipOnEdge: boolean
): number[] {
  const out: number[] = [];
  const addClipped = (ax: number, ay: number, bx: number, by: number): void => {
    // Parameter values (0..1 along A→B) where the segment crosses a polygon edge, plus the endpoints.
    const ts = [0, 1];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const t = segmentEdgeT(ax, ay, bx, by, poly[j].x, poly[j].y, poly[i].x, poly[i].y);
      if (t !== null) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t1 - t0 < 1e-9) continue;
      const mt = (t0 + t1) / 2;
      const mx = ax + (bx - ax) * mt;
      const my = ay + (by - ay) * mt;
      if (skipOnEdge && onPolygonEdge(mx, my, poly)) continue; // the outline draws this run
      if (pointInPolygon(mx, my, poly)) {
        out.push(ax + (bx - ax) * t0, ay + (by - ay) * t0, 0, ax + (bx - ax) * t1, ay + (by - ay) * t1, 0);
      }
    }
  };
  let k = 0;
  for (let i = 0, gx = x0; i <= MAX_GRID_LINES_PER_AXIS && gx <= x1 + 1e-6; i++, gx += pitch) {
    if (tierOf(k++) === tier) addClipped(gx, y0, gx, y1);
  }
  k = 0;
  for (let i = 0, gy = y0; i <= MAX_GRID_LINES_PER_AXIS && gy <= y1 + 1e-6; i++, gy += pitch) {
    if (tierOf(k++) === tier) addClipped(x0, gy, x1, gy);
  }
  return out;
}

/** The A→B parameter where segment AB crosses segment CD, or null if they don't cross in-range. */
function segmentEdgeT(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): number | null {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const t = ((cx - ax) * sy - (cy - ay) * sx) / denom;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / denom;
  if (t <= 0 || t >= 1 || u < 0 || u > 1) return null;
  return t;
}

/** A filled, unlit shape spanning a non-rectangular bed outline, drawn just below z=0. Named 'bedSurface'. */
function bedShapeMesh(poly: Point2[], surface: BedSurface): Mesh {
  const shape = new Shape();
  shape.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i].x, poly[i].y);
  shape.closePath();
  const geom = new ShapeGeometry(shape);
  geom.translate(0, 0, -0.05);
  const material = new MeshBasicMaterial({
    color: surface.color ?? 0x2a2f3a,
    opacity: surface.opacity ?? 1,
    transparent: (surface.opacity ?? 1) < 1,
    side: DoubleSide,
    depthWrite: false
  });
  if (surface.texture) {
    const tex = new CanvasTexture(surface.texture);
    tex.colorSpace = SRGBColorSpace; // a colour image: sample it as sRGB, not linear (#462)
    material.map = tex;
    material.needsUpdate = true;
  }
  const mesh = new Mesh(geom, material);
  mesh.name = 'bedSurface';
  mesh.renderOrder = ORDER_BED_TOP;
  return mesh;
}

/** The bed boundary as a closed loop at z≈0. Named 'bedOutline'. */
function bedOutlineLoop(
  poly: Point2[],
  color: ThemeColor,
  opacity: number,
  renderOrder = 0,
  forceTransparent = false
): LineLoop {
  const pts: number[] = [];
  for (const p of poly) pts.push(p.x, p.y, 0.01);
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(pts, 3));
  // A themed outline is always transparent: it then sorts in three's transparent list, where its
  // renderOrder (above the grid) holds even at opacity 1.
  const material = new LineBasicMaterial({ color, transparent: forceTransparent || opacity < 1, opacity });
  const loop = new LineLoop(geom, material);
  loop.name = 'bedOutline';
  loop.renderOrder = renderOrder;
  return loop;
}

/** An amber outline of a keep-out region at z≈0, or null for a degenerate region. */
function excludedRegionOutline(region: Region2): LineLoop | null {
  const pts: number[] = [];
  if (region.kind === 'rect') {
    // rect stores [min, max]; expand to the 4 corners.
    const [min, max] = region.points;
    if (!min || !max) return null;
    pts.push(min.x, min.y, 0.02, max.x, min.y, 0.02, max.x, max.y, 0.02, min.x, max.y, 0.02);
  } else {
    if (region.points.length < 3) return null;
    for (const p of region.points) pts.push(p.x, p.y, 0.02);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const loop = new LineLoop(geom, new LineBasicMaterial({ color: 0xd08a2a, transparent: true, opacity: 0.9 }));
  loop.name = 'excludedRegion';
  return loop;
}
