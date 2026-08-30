/*
 * demo-kit/models — SOURCE-MODEL (Prepare) fixtures for the model-viewer adapters (DD-031), the
 * counterpart to fixtures.js (which holds toolpath/Preview G-code). Both are fully synthetic and
 * MIT-clean: the STL is generated here; the 3MF is the generated colored fixture (model-3mf-fixture.js).
 * Each fixture's `source()` returns a `ModelSourceInput` ({ kind, bytes }) ready for setSource — no
 * engine handles, so examples still consume the real published adapter.
 */
import { TOWER_3MF_BASE64 } from './model-3mf-fixture.js';

/** Binary STL from a triangle list, with computed face normals. */
function buildStl(triangles) {
  const buf = new ArrayBuffer(84 + triangles.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triangles.length, true);
  let o = 84;
  for (const [a, b, c] of triangles) {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const p of [a, b, c]) {
      dv.setFloat32(o, p[0], true);
      dv.setFloat32(o + 4, p[1], true);
      dv.setFloat32(o + 8, p[2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

/** An axis-aligned box as 12 triangles. */
function box(x0, y0, z0, x1, y1, z1) {
  const v = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1]
  ];
  const f = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7]
  ];
  return f.map(([a, b, c]) => [v[a], v[b], v[c]]);
}

/** The synthetic "tower" STL (a stacked pair of boxes). Carries no colour → materials: unavailable. */
export function buildDemoStl() {
  return buildStl([...box(-16, -16, 0, 16, 16, 10), ...box(-9, -9, 10, 9, 9, 26)]);
}

/** base64 → Uint8Array (browser btoa/atob path). */
function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

/**
 * Source-model fixtures organized by what each demonstrates. `source()` builds a fresh
 * `ModelSourceInput` for `controls.setSource` / the `source` prop.
 */
export const MODEL_FIXTURES = [
  {
    id: 'stl-tower',
    label: 'Tower (STL)',
    blurb: 'A synthetic STL — no colour data, so materials reads the honest "unavailable" tier.',
    source: () => ({ kind: 'stl', bytes: buildDemoStl() })
  },
  {
    id: 'colored-3mf',
    label: 'Colored blocks (3MF)',
    blurb: 'A 3MF with real basematerials colours — materials reads "known" and the colours are shown.',
    source: () => ({ kind: '3mf', bytes: base64ToBytes(TOWER_3MF_BASE64) })
  }
];

/** Flat lookup by id. */
export const MODEL_FIXTURE_BY_ID = Object.fromEntries(MODEL_FIXTURES.map((m) => [m.id, m]));
