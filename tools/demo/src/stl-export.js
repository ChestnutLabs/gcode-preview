/*
 * STL export of the rendered toolpath (issue #152) — a SHOWCASE-app feature, deliberately kept in
 * tools/demo and NOT in the reusable packages (per the #152 / #118 scoping). Self-contained: it reads
 * only the public `ToolpathIR` (via `renderer.ir`), no renderer internals.
 *
 * Each productive move (extrude or cut, never travels/rapids) becomes a square-section tube; the tubes
 * are emitted as a binary STL. Large toolpaths are strided down to a triangle budget so the download
 * stays sane (the count that was dropped is returned for an honest note — no silent truncation).
 */
import { MoveKind } from '@chestnutlabs/toolpath-core';

const TRIS_PER_SEGMENT = 8; // 4 side quads of the square tube, no end caps

/**
 * Build a binary STL of the toolpath's productive moves.
 * @param {import('@chestnutlabs/toolpath-core').ToolpathIR} ir
 * @param {{ radius?: number, kindMask?: number, maxTriangles?: number }} [opts]
 * @returns {{ buffer: ArrayBuffer, segments: number, emitted: number, triangles: number }}
 */
export function toolpathToStl(ir, opts = {}) {
  const seg = ir.segments;
  const radius = opts.radius ?? 0.2; // half-width of the square tube, mm
  const kindMask = opts.kindMask ?? MoveKind.Extrude | MoveKind.Cut;
  const maxTriangles = opts.maxTriangles ?? 2_000_000;
  const o = ir.header.originOffset ?? { x: 0, y: 0, z: 0 };

  // Select productive, non-degenerate segments.
  const idx = [];
  for (let i = 0; i < seg.count; i++) {
    if ((seg.kind[i] & kindMask) === 0) continue;
    const dx = seg.x1[i] - seg.x0[i];
    const dy = seg.y1[i] - seg.y0[i];
    const dz = seg.z1[i] - seg.z0[i];
    if (dx * dx + dy * dy + dz * dz < 1e-18) continue;
    idx.push(i);
  }

  // Stride down to the triangle budget (honest decimation — the caller reports what was dropped).
  const stride = Math.max(1, Math.ceil((idx.length * TRIS_PER_SEGMENT) / maxTriangles));
  const chosen = stride === 1 ? idx : idx.filter((_, k) => k % stride === 0);

  const triCount = chosen.length * TRIS_PER_SEGMENT;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buffer);
  dv.setUint32(80, triCount, true); // 80-byte header left zero; triangle count little-endian
  let off = 84;

  const tri = (a, b, c) => {
    // Real facet normal (right-hand winding), normalized.
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    dv.setFloat32(off, nx, true);
    dv.setFloat32(off + 4, ny, true);
    dv.setFloat32(off + 8, nz, true);
    const pts = [a, b, c];
    for (let p = 0; p < 3; p++) {
      dv.setFloat32(off + 12 + p * 12, pts[p][0], true);
      dv.setFloat32(off + 16 + p * 12, pts[p][1], true);
      dv.setFloat32(off + 20 + p * 12, pts[p][2], true);
    }
    dv.setUint16(off + 48, 0, true); // attribute byte count
    off += 50;
  };

  for (const i of chosen) {
    const ax = seg.x0[i] + o.x;
    const ay = seg.y0[i] + o.y;
    const az = seg.z0[i] + o.z;
    const bx = seg.x1[i] + o.x;
    const by = seg.y1[i] + o.y;
    const bz = seg.z1[i] + o.z;
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl;
    dy /= dl;
    dz /= dl;
    // An arbitrary unit perpendicular u, then v = d × u — the square cross-section basis.
    let ux;
    let uy;
    let uz;
    if (Math.abs(dz) < 0.9) {
      ux = -dy;
      uy = dx;
      uz = 0;
    } else {
      ux = 0;
      uy = -dz;
      uz = dy;
    }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = dy * uz - dz * uy;
    const vy = dz * ux - dx * uz;
    const vz = dx * uy - dy * ux;
    const corners = (px, py, pz) => [
      [px + radius * ux + radius * vx, py + radius * uy + radius * vy, pz + radius * uz + radius * vz],
      [px - radius * ux + radius * vx, py - radius * uy + radius * vy, pz - radius * uz + radius * vz],
      [px - radius * ux - radius * vx, py - radius * uy - radius * vy, pz - radius * uz - radius * vz],
      [px + radius * ux - radius * vx, py + radius * uy - radius * vy, pz + radius * uz - radius * vz]
    ];
    const A = corners(ax, ay, az);
    const B = corners(bx, by, bz);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      tri(A[k], A[k2], B[k2]);
      tri(A[k], B[k2], B[k]);
    }
  }

  return { buffer, segments: idx.length, emitted: chosen.length, triangles: triCount };
}

/** Trigger a browser download of an STL built from `ir`. Returns the export summary for a status note. */
export function downloadToolpathStl(ir, filename = 'toolpath.stl', opts = {}) {
  const result = toolpathToStl(ir, opts);
  const blob = new Blob([result.buffer], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return result;
}
