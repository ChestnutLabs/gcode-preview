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

// ---- Synthetic two-plate Bambu/Orca-style 3MF (DD-032 / DD-030 plate-selection demo) ----
// Generated here, in the browser: a stored (uncompressed) ZIP holding a model, a `printable_area` project
// config and a `model_settings.config` that declares two plates. It is a SYNTHETIC fixture written from the
// observed file layout, not an export from a slicer, so wherever it appears it is labelled synthetic.
// Plate 2 is authored one 307.2 mm workspace cell (256 mm bed x 1.2) over in +X, as exported projects do.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal stored-only ZIP writer: `files` is `[{ name, data: Uint8Array }]`. */
function makeStoredZip(files) {
  const te = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = te.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length + f.data.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    lh.set(f.data, 30 + name.length);
    locals.push(lh);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    centrals.push(ch);
    offset += lh.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** The bed the two-plate fixture is authored for (mm). Pass it as `buildVolume` to see `known` / `inferred`. */
export const TWO_PLATE_BED = { x: 256, y: 256, z: 256 };

/** Build the synthetic two-plate 3MF: a 40 x 40 x 20 mm block per plate, plate 2 one workspace cell over. */
export function buildTwoPlate3mf() {
  const te = new TextEncoder();
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
 <object id="10" type="model"><mesh>
  <vertices>
   <vertex x="0" y="0" z="0"/><vertex x="40" y="0" z="0"/><vertex x="40" y="40" z="0"/><vertex x="0" y="40" z="0"/>
   <vertex x="0" y="0" z="20"/><vertex x="40" y="0" z="20"/><vertex x="40" y="40" z="20"/><vertex x="0" y="40" z="20"/>
  </vertices>
  <triangles>
   <triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="3" v3="2"/><triangle v1="4" v2="5" v3="6"/><triangle v1="4" v2="6" v3="7"/>
   <triangle v1="0" v2="1" v3="5"/><triangle v1="0" v2="5" v3="4"/><triangle v1="1" v2="2" v3="6"/><triangle v1="1" v2="6" v3="5"/>
   <triangle v1="2" v2="3" v3="7"/><triangle v1="2" v2="7" v3="6"/><triangle v1="3" v2="0" v3="4"/><triangle v1="3" v2="4" v3="7"/>
  </triangles>
 </mesh></object>
</resources><build>
 <item objectid="10" transform="1 0 0 0 1 0 0 0 1 108 108 0"/>
 <item objectid="10" transform="1 0 0 0 1 0 0 0 1 415.2 108 0"/>
</build></model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Plate one (synthetic)"/>
    <model_instance><metadata key="object_id" value="10"/><metadata key="instance_id" value="0"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="Plate two (synthetic)"/>
    <model_instance><metadata key="object_id" value="10"/><metadata key="instance_id" value="1"/></model_instance>
  </plate>
</config>`;
  const project = JSON.stringify({ printable_area: ['0x0', '256x0', '256x256', '0x256'] });
  return makeStoredZip([
    { name: '3D/3dmodel.model', data: te.encode(model) },
    { name: 'Metadata/project_settings.config', data: te.encode(project) },
    { name: 'Metadata/model_settings.config', data: te.encode(settings) }
  ]);
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
  },
  {
    id: 'two-plate-3mf',
    label: 'Two plates (3MF, synthetic)',
    blurb:
      'A SYNTHETIC two-plate Bambu/Orca-style project, generated for this demo (not a slicer export). ' +
      'Pick a plate to render it alone; the placement line shows how the plate position was decided.',
    plates: true,
    source: () => ({ kind: '3mf', bytes: buildTwoPlate3mf() })
  }
];

/** Flat lookup by id. */
export const MODEL_FIXTURE_BY_ID = Object.fromEntries(MODEL_FIXTURES.map((m) => [m.id, m]));
