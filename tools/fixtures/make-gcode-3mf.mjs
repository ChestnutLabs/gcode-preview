/*
 * Fixture generator (DD-005 phase 2, issue #74): builds a Chestnut-constructed
 * multi-plate `.gcode.3mf` plus the adversarial archive corpus, deterministic
 * byte-for-byte (fixed timestamps) so manifest sha256 entries stay stable.
 *
 * Usage: node tools/fixtures/make-gcode-3mf.mjs
 * Output: test-data/fixtures/containers/
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-data/fixtures/containers');
fs.mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const u16 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);

/** entries: {name, data:Buffer, deflate?:bool, corrupt?:{crc?|localName?|encrypted?|truncate?}} */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const comp = e.deflate ? zlib.deflateRawSync(data) : data;
    const method = e.deflate ? 8 : 0;
    let crc = crc32(data);
    if (e.corrupt?.crc) crc = (crc ^ 0xdeadbeef) >>> 0;
    const flags = e.corrupt?.encrypted ? 0x1 : 0;
    const localName = e.corrupt?.localName ? Buffer.from(e.corrupt.localName, 'utf8') : nameBuf;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0x2100),
      u32(crc),
      u32(comp.length),
      u32(data.length),
      u16(localName.length),
      u16(0),
      localName,
      comp
    ]);
    locals.push(local);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(flags),
        u16(method),
        u16(0),
        u16(0x2100),
        u32(crc),
        u32(comp.length),
        u32(data.length),
        u16(nameBuf.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBuf
      ])
    );
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(offset),
    u16(0)
  ]);
  let zip = Buffer.concat([...locals, cd, eocd]);
  const truncate = entries.find((e) => e.corrupt?.truncate);
  if (truncate) zip = zip.subarray(0, Math.floor(zip.length * 0.6));
  return zip;
}

function plateGcode(plate, lines) {
  // Bambu-style header + FEATURE markers so the container + orca-bambu
  // dialect COMPOSITION path is exercised end to end (DD-005 phase 3).
  const out = [
    '; BambuStudio 01.09.00.60',
    `; generated fixture plate ${plate}`,
    'G0 X10 Y10 Z0.2',
    '; FEATURE: Outer wall'
  ];
  const half = Math.floor(lines / 2);
  for (let i = 1; i <= lines; i++) {
    if (i === half) out.push('; FEATURE: Sparse infill');
    out.push(`G1 X${10 + (i % 40)} Y${10 + ((i * 3) % 30)} E${i} F1500`);
  }
  return Buffer.from(out.join('\n'), 'utf8');
}

const settings = Buffer.from(
  JSON.stringify({
    printable_area: ['0x0', '256x0', '256x256', '0x256'],
    printable_height: 256,
    printer_model: 'Chestnut Test Printer X1',
    printer_settings_id: 'chestnut-x1',
    nozzle_diameter: ['0.4'],
    filament_type: ['PLA', 'PETG'],
    filament_colour: ['#22AA55', '#5566EE'],
    version: '1.0.0'
  }),
  'utf8'
);

const write = (name, buf) => {
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`${name}: ${buf.length} B`);
};

// Well-formed multi-plate project (mixed stored + deflate).
write(
  'mini-project.gcode.3mf',
  makeZip([
    { name: 'Metadata/plate_1.gcode', data: plateGcode(1, 400), deflate: true },
    { name: 'Metadata/plate_2.gcode', data: plateGcode(2, 250), deflate: true },
    { name: 'Metadata/project_settings.config', data: settings, deflate: true },
    { name: '3D/3dmodel.model', data: Buffer.from('<model/>'), deflate: false }
  ])
);

// Model/project 3MF (meshes + settings, NO sliced plates) — the common user
// mistake of loading a saved project instead of an exported sliced file.
write(
  'model-project.3mf',
  makeZip([
    { name: '3D/3dmodel.model', data: Buffer.from('<model unit="millimeter"><resources/></model>'), deflate: true },
    { name: 'Metadata/project_settings.config', data: settings, deflate: true },
    { name: 'Metadata/plate_1.png', data: Buffer.alloc(64, 1), deflate: false }
  ])
);

// Adversarial corpus (each exercises one §4.4/§7 defense).
write(
  'adv-bad-crc.gcode.3mf',
  makeZip([
    { name: 'Metadata/plate_1.gcode', data: plateGcode(1, 50), deflate: true, corrupt: { crc: true } },
    { name: 'Metadata/project_settings.config', data: settings, deflate: true }
  ])
);
write(
  'adv-encrypted.gcode.3mf',
  makeZip([{ name: 'Metadata/plate_1.gcode', data: plateGcode(1, 50), deflate: true, corrupt: { encrypted: true } }])
);
write(
  'adv-header-mismatch.gcode.3mf',
  makeZip([
    {
      name: 'Metadata/plate_1.gcode',
      data: plateGcode(1, 50),
      deflate: true,
      corrupt: { localName: 'Metadata/other_name.gcode' }
    }
  ])
);
write(
  'adv-duplicate-plate.gcode.3mf',
  makeZip([
    { name: 'Metadata/plate_1.gcode', data: plateGcode(1, 50), deflate: true },
    { name: 'Metadata/PLATE_1.gcode', data: plateGcode(9, 40), deflate: true } // canonical duplicate of a payload
  ])
);
write(
  'adv-traversal-names.gcode.3mf',
  makeZip([
    { name: '../../../evil.gcode', data: Buffer.from('G1 X1'), deflate: false },
    { name: 'C:/windows/evil2.gcode', data: Buffer.from('G1 X2'), deflate: false },
    { name: 'Metadata/plate_1.gcode', data: plateGcode(1, 50), deflate: true }
  ])
);
write(
  'adv-truncated.gcode.3mf',
  makeZip([{ name: 'Metadata/plate_1.gcode', data: plateGcode(1, 400), deflate: true, corrupt: { truncate: true } }])
);
// Header lies small, payload inflates big (bomb-style): claimed sizes are consistent
// in central+local, but we cap via limits in the test rather than the file lying —
// craft a REAL lie: patch uncompressedSize down after build.
{
  const big = Buffer.alloc(2 * 1024 * 1024, 0x41); // 2MB of 'A' compresses tiny
  const zip = makeZip([{ name: 'Metadata/plate_1.gcode', data: big, deflate: true }]);
  // Patch BOTH local (offset 22) and central uncompressedSize fields to lie (claim 1KB).
  const lie = u32(1024);
  lie.copy(zip, 22); // local header uncompressedSize
  const cdStart = zip.length - 22 - (46 + 'Metadata/plate_1.gcode'.length);
  lie.copy(zip, cdStart + 24); // central uncompressedSize
  // CRC stays correct for the REAL data; size check must trip first via cap accounting.
  write('adv-size-lie.gcode.3mf', zip);
}
console.log('done');
