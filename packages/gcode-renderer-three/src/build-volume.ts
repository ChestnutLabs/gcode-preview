/**
 * Build-volume visualization (DD-004 §4.2/§6.2, phase 2).
 *
 * Printer-coordinate space (Z-up; the scene root applies the Y-up rotation once):
 * a floor grid at z=0 spanning [0..x]×[0..y] — cartesian-printer convention, the
 * bed origin is the CORNER, matching the G-code coordinates the toolpath renders
 * at — a wireframe box of the volume, and an origin marker at printer (0,0,0).
 */
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three';
import type { ThemeColor } from './theme.js';

export interface BuildVolumeDef {
  x: number;
  y: number;
  z: number;
  /** Grid pitch in mm (default 10). */
  grid?: number;
  /** Bed minimum corner in printer coordinates (default 0,0 — DD-005 §4.2 machines may offset). */
  min?: { x: number; y: number };
}

/** Themed styling (DD-009 D4, #153). Omitted fields keep the original constants; the
 *  origin tripod (semantic RGB axes) is never themed. */
export interface BuildVolumeStyle {
  gridColor?: ThemeColor;
  gridOpacity?: number;
  boxColor?: ThemeColor;
  boxOpacity?: number;
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

  // Origin marker at printer (0,0,0): a small tripod.
  const m = Math.max(2, pitch / 2);
  group.add(lines([0, 0, 0, m, 0, 0], 0xcc4444));
  group.add(lines([0, 0, 0, 0, m, 0], 0x44cc44));
  group.add(lines([0, 0, 0, 0, 0, m], 0x4444cc));

  return group;
}
