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
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry
} from 'three';
import type { Region2 } from '@chestnutlabs/toolpath-core';
import type { BedSurface, ThemeColor } from './theme.js';

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
}

function lines(positions: number[], color: ThemeColor, opacity = 1): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new LineSegments(geometry, material);
}

/** Build the volume group. Caller owns disposal (traverse geometries/materials). */
export function createBuildVolume(def: BuildVolumeDef, style?: BuildVolumeStyle): Group {
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

  // Filled build-plate surface (#185), UNDER the grid so grid lines read on top. A single unlit
  // plane spanning the bed; drawn slightly below z=0 to avoid z-fighting the grid and the first
  // layer. `mode:'none'` (default) skips it entirely — the bare-grid look is unchanged.
  const surface = style?.bedSurface;
  if (surface && surface.mode === 'solid') {
    group.add(bedPlate(x0, y0, x1, y1, surface));
  }

  // Floor grid at z=0 spanning [min..min+size]: the bed occupies the same
  // coordinates the G-code (and the toolpath) uses.
  const grid: number[] = [];
  for (let gx = x0; gx <= x1 + 1e-6; gx += pitch) {
    grid.push(gx, y0, 0, gx, y1, 0);
  }
  for (let gy = y0; gy <= y1 + 1e-6; gy += pitch) {
    grid.push(x0, gy, 0, x1, gy, 0);
  }
  group.add(lines(grid, gridColor, gridOpacity));

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
    box.push(x1, y1, 0, x2, y2, 0); // floor edges
    box.push(x1, y1, z, x2, y2, z); // top edges
    box.push(x1, y1, 0, x1, y1, z); // verticals
  }
  group.add(lines(box, boxColor, boxOpacity));

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
    material.map = tex;
    material.needsUpdate = true;
  }
  const mesh = new Mesh(geom, material);
  mesh.name = 'bedSurface';
  mesh.renderOrder = -1; // draw first, behind everything
  return mesh;
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
