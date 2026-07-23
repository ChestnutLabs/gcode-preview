/**
 * Build-volume visualization (DD-004 §4.2/§6.2, phase 2).
 *
 * Printer-coordinate space (Z-up; the scene root applies the Y-up rotation once):
 * an XY-centered floor grid at z=0, a wireframe box of the volume, and an origin
 * marker at printer (0,0,0). Kept deliberately simple in phase 2.
 */
import { BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments } from 'three';

export interface BuildVolumeDef {
  x: number;
  y: number;
  z: number;
  /** Grid pitch in mm (default 10). */
  grid?: number;
}

function lines(positions: number[], color: number, opacity = 1): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new LineSegments(geometry, material);
}

/** Build the volume group. Caller owns disposal (traverse geometries/materials). */
export function createBuildVolume(def: BuildVolumeDef): Group {
  const group = new Group();
  group.name = 'buildVolume';
  const hx = def.x / 2;
  const hy = def.y / 2;
  const pitch = def.grid ?? 10;

  // Floor grid at z=0, centered on XY (common firmware convention).
  const grid: number[] = [];
  for (let gx = -hx; gx <= hx + 1e-6; gx += pitch) {
    grid.push(gx, -hy, 0, gx, hy, 0);
  }
  for (let gy = -hy; gy <= hy + 1e-6; gy += pitch) {
    grid.push(-hx, gy, 0, hx, gy, 0);
  }
  group.add(lines(grid, 0x448844, 0.35));

  // Volume wireframe box.
  const z = def.z;
  const box: number[] = [];
  const corners: [number, number][] = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy]
  ];
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % 4];
    box.push(x1, y1, 0, x2, y2, 0); // floor edges
    box.push(x1, y1, z, x2, y2, z); // top edges
    box.push(x1, y1, 0, x1, y1, z); // verticals
  }
  group.add(lines(box, 0x888888, 0.5));

  // Origin marker at printer (0,0,0): a small tripod.
  const m = Math.max(2, pitch / 2);
  group.add(lines([0, 0, 0, m, 0, 0], 0xcc4444));
  group.add(lines([0, 0, 0, 0, m, 0], 0x44cc44));
  group.add(lines([0, 0, 0, 0, 0, m], 0x4444cc));

  return group;
}
