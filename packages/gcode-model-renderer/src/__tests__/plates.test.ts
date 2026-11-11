/**
 * DD-025 — multi-plate model structure. Tests the Bambu/Orca `model_settings.config` plate parser and the
 * `ModelScene.plates` / placement-level `plateIds` / `capabilities.plates` exposure. All fixtures are fully
 * synthetic and MIT-clean (clean-room from the observed `<plate>` format, parity with the RR-005 approach).
 */
import { describe, it, expect } from 'vitest';
import { parse3mf, parsePlateConfig, parseObjectExtruders } from '../three-mf.js';

// --- minimal stored (uncompressed) ZIP writer, so fixtures need no zip dependency ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
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
  for (const l of locals) {
    out.set(l, p);
    p += l.length;
  }
  for (const c of centrals) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out;
}
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// Two objects (ids 10, 22 — the real-file id style), two build items placed far apart (plate A near x=128,
// plate B near x=435 as Bambu lays plates out spatially).
const TWO_OBJECTS = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <object id="10" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="5"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="3"/></triangles>
 </mesh></object>
 <object id="22" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="8" y="0" z="0"/><vertex x="0" y="8" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
 </mesh></object>
</resources><build>
 <item objectid="10" transform="1 0 0 0 1 0 0 0 1 128 128 0"/>
 <item objectid="22" transform="1 0 0 0 1 0 0 0 1 435 128 0"/>
</build></model>`;

const TWO_PLATE_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="10"><metadata key="name" value="Cat"/></object>
  <object id="22"><metadata key="name" value="Dog"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Plate A"/>
    <model_instance>
      <metadata key="object_id" value="10"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value=""/>
    <model_instance>
      <metadata key="object_id" value="22"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
</config>`;

// Object 10 placed twice; the two placements are assigned to DIFFERENT plates — a shared master spanning
// plates (refinement 1: plate membership is per placement, not per master).
const SHARED_MASTER_MODEL = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <object id="10" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
 </mesh></object>
</resources><build>
 <item objectid="10" transform="1 0 0 0 1 0 0 0 1 128 128 0"/>
 <item objectid="10" transform="1 0 0 0 1 0 0 0 1 435 128 0"/>
</build></model>`;

const SHARED_MASTER_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="10"/><metadata key="instance_id" value="0"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <model_instance><metadata key="object_id" value="10"/><metadata key="instance_id" value="1"/></model_instance>
  </plate>
</config>`;

const SINGLE_NO_SETTINGS = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <object id="1" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
 </mesh></object>
</resources><build><item objectid="1"/></build></model>`;

describe('parsePlateConfig (DD-025)', () => {
  it('maps each model_instance (object_id#instance_id) to its plate, with names and order', () => {
    const pc = parsePlateConfig(TWO_PLATE_SETTINGS);
    expect(pc).not.toBeNull();
    expect(pc!.order).toEqual([1, 2]);
    expect(pc!.membership.get('10#0')).toBe(1);
    expect(pc!.membership.get('22#0')).toBe(2);
    expect(pc!.names.get(1)).toBe('Plate A');
    expect(pc!.names.has(2)).toBe(false); // empty plater_name is not recorded
  });

  it('returns null when no <plate> is declared', () => {
    expect(parsePlateConfig('<config><object id="1"/></config>')).toBeNull();
    expect(parsePlateConfig('not xml at all')).toBeNull();
  });
});

// #468 — `parsePlateConfig` must stay linear on a hostile config. Fixtures below are literal strings.
const PID = (n: number): string => `<metadata key="plater_id" value="${n}"/>`;
const MI = (obj: number, ins: number): string =>
  `<model_instance><metadata key="object_id" value="${obj}"/><metadata key="instance_id" value="${ins}"/></model_instance>`;
const view = (pc: ReturnType<typeof parsePlateConfig>) =>
  pc === null
    ? null
    : {
        order: pc.order,
        membership: [...pc.membership.entries()].sort(([a], [b]) => a.localeCompare(b)),
        names: [...pc.names.entries()].sort(([a], [b]) => a - b)
      };

/** The pre-#468 regex implementation, kept verbatim as a differential oracle for well-formed/odd configs. */
function legacyParsePlateConfig(xml: string): ReturnType<typeof parsePlateConfig> {
  const plateBlocks = xml.match(/<plate\b[\s\S]*?<\/plate>/gi);
  if (plateBlocks === null || plateBlocks.length === 0) return null;
  const membership = new Map<string, number>();
  const names = new Map<number, string>();
  const order: number[] = [];
  for (const block of plateBlocks) {
    const idM = /key="plater_id"\s+value="(\d+)"/i.exec(block);
    if (idM === null) continue;
    const plateId = parseInt(idM[1], 10);
    if (!Number.isFinite(plateId)) continue;
    order.push(plateId);
    const nameM = /key="plater_name"\s+value="([^"]*)"/i.exec(block);
    if (nameM !== null && nameM[1].length > 0) names.set(plateId, nameM[1]);
    for (const inst of block.match(/<model_instance\b[\s\S]*?<\/model_instance>/gi) ?? []) {
      const objM = /key="object_id"\s+value="(\d+)"/i.exec(inst);
      const insM = /key="instance_id"\s+value="(\d+)"/i.exec(inst);
      if (objM === null || insM === null) continue;
      membership.set(`${objM[1]}#${insM[1]}`, plateId);
    }
  }
  return order.length > 0 ? { membership, names, order } : null;
}

describe('parsePlateConfig linear scan (#468)', () => {
  const THREE_PLATES = `<?xml version="1.0"?><config>
  <plate>${PID(1)}<metadata key="plater_name" value="A"/>${MI(10, 0)}${MI(10, 1)}</plate>
  <plate>${PID(2)}${MI(11, 0)}</plate>
  <plate>${PID(5)}<metadata key="plater_name" value="E"/>${MI(12, 3)}</plate>
</config>`;

  it('parses a multi-plate config to the exact expected structure', () => {
    expect(view(parsePlateConfig(THREE_PLATES))).toEqual({
      order: [1, 2, 5],
      membership: [
        ['10#0', 1],
        ['10#1', 1],
        ['11#0', 2],
        ['12#3', 5]
      ],
      names: [
        [1, 'A'],
        [5, 'E']
      ]
    });
  });

  it('matches the old regex implementation on well-formed and odd configs', () => {
    const fixtures = [
      THREE_PLATES,
      TWO_PLATE_SETTINGS,
      SHARED_MASTER_SETTINGS,
      `<plate>${PID(1)}</plate><plate>${PID(2)}</plate>`,
      `<plate>${PID(1)}<plate>${PID(2)}${MI(3, 0)}</plate>${MI(4, 0)}</plate>`,
      `<plate>${PID(1)}${MI(10, 0)}</plate><plate>${PID(2)}${MI(11, 0)}`,
      `<plate>${PID(1)}${MI(10, 0)}<model_instance><metadata key="object_id" value="11"/></plate>`,
      `<PLATE>${PID(3)}</plate><plate>${PID(4)}</PLATE><Plate>${PID(6)}</Plate>`,
      '<config><object id="1"/></config>',
      ''
    ];
    for (const xml of fixtures) expect(view(parsePlateConfig(xml))).toEqual(view(legacyParsePlateConfig(xml)));
  });

  it('keeps the word boundary: <plates> and <plate_x> are not plates, <plate id="9"> is', () => {
    expect(parsePlateConfig(`<plates>${PID(7)}</plate>`)).toBeNull();
    expect(parsePlateConfig(`<plate_x>${PID(7)}</plate>`)).toBeNull();
    expect(view(parsePlateConfig(`<plate id="9">${PID(7)}</plate>`))?.order).toEqual([7]);
    expect(view(parsePlateConfig(`<plate>${PID(8)}</plate>`))?.order).toEqual([8]);
  });

  it('is case-insensitive on the open tag and on the close tag independently', () => {
    expect(view(parsePlateConfig(`<PLATE>${PID(3)}</plate>`))?.order).toEqual([3]);
    expect(view(parsePlateConfig(`<plate>${PID(4)}</PLATE>`))?.order).toEqual([4]);
    expect(view(parsePlateConfig(`<Plate>${PID(6)}</Plate>`))?.order).toEqual([6]);
  });

  it('takes non-overlapping blocks: a plate opened inside another belongs to the outer block', () => {
    const pc = view(parsePlateConfig(`<plate>${PID(1)}<plate>${PID(2)}${MI(3, 0)}</plate>`));
    expect(pc).toEqual({ order: [1], membership: [['3#0', 1]], names: [] });
    expect(view(parsePlateConfig(`<plate>${PID(1)}</plate><plate>${PID(2)}</plate>`))?.order).toEqual([1, 2]);
  });

  it('keeps the plates already closed when a later <plate> never closes', () => {
    const pc = view(parsePlateConfig(`<plate>${PID(1)}${MI(10, 0)}</plate><plate>${PID(2)}${MI(11, 0)}`));
    expect(pc).toEqual({ order: [1], membership: [['10#0', 1]], names: [] });
  });

  it('keeps the model_instances already closed when a later one never closes', () => {
    const open = '<model_instance><metadata key="object_id" value="11"/><metadata key="instance_id" value="0"/>';
    const pc = view(parsePlateConfig(`<plate>${PID(1)}${MI(10, 0)}${open}</plate>`));
    expect(pc).toEqual({ order: [1], membership: [['10#0', 1]], names: [] });
  });

  it('returns promptly on 1 MiB of unclosed <plate opens', () => {
    const xml = '<plate '.repeat(Math.ceil(1_048_576 / 7));
    const t0 = performance.now();
    const pc = parsePlateConfig(xml);
    const ms = performance.now() - t0;
    expect(pc).toBeNull();
    expect(ms).toBeLessThan(2000);
  }, 20_000);

  it('returns promptly on 1 MiB of unclosed <model_instance opens inside a closed plate', () => {
    const xml = `<plate>${PID(1)}${'<model_instance '.repeat(65_536)}</plate>`;
    const t0 = performance.now();
    const pc = view(parsePlateConfig(xml));
    const ms = performance.now() - t0;
    expect(pc).toEqual({ order: [1], membership: [], names: [] });
    expect(ms).toBeLessThan(2000);
  }, 20_000);
});

const EX = (n: number): string => `<metadata key="extruder" value="${n}"/>`;
const extruders = (xml: string): [string, number][] =>
  [...parseObjectExtruders(xml).entries()].sort(([a], [b]) => a.localeCompare(b));

/** The pre-#468 regex implementation of parseObjectExtruders, kept verbatim as a differential oracle. */
function legacyParseObjectExtruders(xml: string): [string, number][] {
  const map = new Map<string, number>();
  const headerRe = /<(?:object|part)\s+id="(\d+)"[^>]*>([\s\S]*?)(?=<(?:object|part)\s+id="|<\/config>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(xml)) !== null) {
    const ext = /key="extruder"\s+value="(\d+)"/i.exec(m[2]);
    if (ext !== null) {
      const n = parseInt(ext[1], 10);
      if (Number.isFinite(n) && n >= 1) map.set(m[1], n);
    }
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

describe('parseObjectExtruders linear scan (#468)', () => {
  it('maps objects and parts to their own extruder in a multi-object config', () => {
    const xml = `<config>
 <object id="10">${EX(1)}<part id="1">${EX(1)}</part><part id="9">${EX(2)}</part></object>
 <object id="11">${EX(3)}</object>
</config>`;
    expect(extruders(xml)).toEqual([
      ['1', 1],
      ['10', 1],
      ['11', 3],
      ['9', 2]
    ]);
  });

  it('ends a segment at the next part header (object without its own extruder gets none)', () => {
    expect(extruders(`<object id="5"><part id="6">${EX(2)}</part></object>`)).toEqual([['6', 2]]);
  });

  it('ends a segment at </config>, and still reads objects declared after it', () => {
    expect(extruders(`<object id="1"></config>${EX(2)}`)).toEqual([]);
    expect(extruders(`<object id="1">${EX(1)}</config><object id="2">${EX(2)}`)).toEqual([
      ['1', 1],
      ['2', 2]
    ]);
  });

  it('runs the last segment to the end of the input', () => {
    expect(extruders(`<object id="1">${EX(3)}`)).toEqual([['1', 3]]);
  });

  it('takes a header tag to the first > after the id, even across a later header prefix', () => {
    expect(extruders(`<object id="1" <object id="2">${EX(4)}`)).toEqual([['1', 4]]);
    expect(extruders(`<object id="1" name="a>b">${EX(2)}`)).toEqual([['1', 2]]);
  });

  it('keeps earlier results when a later header has no > at all', () => {
    expect(extruders(`<object id="1">${EX(2)}<object id="3" `)).toEqual([['1', 2]]);
  });

  it('ends a segment at a non-numeric-id header prefix without reading it as a header', () => {
    expect(extruders(`<object id="1"><object id="x">${EX(2)}</object>`)).toEqual([]);
  });

  it('is case-sensitive on headers, header prefixes and </config>', () => {
    expect(extruders(`<OBJECT id="1">${EX(2)}`)).toEqual([]);
    expect(extruders(`<object id="1"><OBJECT id="2">${EX(4)}`)).toEqual([['1', 4]]);
    expect(extruders(`<object id="1"></CONFIG>${EX(4)}`)).toEqual([['1', 4]]);
  });

  it('accepts any whitespace between the tag name and id (headers and segment ends)', () => {
    expect(extruders(`<object\n id="1">\n<part\tid="2">${EX(5)}`)).toEqual([['2', 5]]);
  });

  it('matches the old regex implementation on well-formed and odd configs', () => {
    const fixtures = [
      EXTRUDER_SETTINGS,
      `<config><object id="10">${EX(1)}<part id="1">${EX(1)}</part><part id="9">${EX(2)}</part></object></config>`,
      `<object id="5"><part id="6">${EX(2)}</part></object>`,
      `<object id="1">${EX(1)}</config><object id="2">${EX(2)}`,
      `<object id="1" <object id="2">${EX(4)}`,
      `<object id="1">${EX(2)}<object id="3" `,
      `<object id="1"><object id="x">${EX(2)}</object>`,
      `<object\n id="1">\n<part\tid="2">${EX(5)}`,
      `<object id="1"><OBJECT id="2">${EX(4)}`,
      `<object id="1">${EX(0)}${EX(2)}<object id="2">${EX(3)}${EX(4)}`,
      '<config><object id="1"/></config>',
      ''
    ];
    for (const xml of fixtures) expect(extruders(xml)).toEqual(legacyParseObjectExtruders(xml));
  });

  it('returns promptly on 1 MiB of object headers that never close', () => {
    const xml = '<object id="1" '.repeat(69_906);
    const t0 = performance.now();
    const n = parseObjectExtruders(xml).size;
    const ms = performance.now() - t0;
    expect(n).toBe(0);
    expect(ms).toBeLessThan(2000);
  }, 20_000);
});

describe('parse3mf plate exposure (DD-025)', () => {
  it('exposes ModelScene.plates + placement plateIds + capabilities.plates for a declared multi-plate file', async () => {
    const scene = await parse3mf(
      makeZip([
        { name: '3D/3dmodel.model', data: enc(TWO_OBJECTS) },
        { name: 'Metadata/model_settings.config', data: enc(TWO_PLATE_SETTINGS) }
      ])
    );
    expect(scene.capabilities.plates).toBe('known');
    expect(scene.plates).toBeDefined();
    expect(scene.plates!.list).toHaveLength(2);

    const [p1, p2] = scene.plates!.list;
    expect(p1).toMatchObject({ id: 1, name: 'Plate A', objectCount: 1, instanceCount: 1 });
    expect(p2).toMatchObject({ id: 2, objectCount: 1, instanceCount: 1 });
    expect(p2.name).toBeUndefined();
    // Per-plate bounds reflect the placement offsets (plate A near x=128, plate B near x=435).
    expect(p1.bounds.min[0]).toBeCloseTo(128, 0);
    expect(p2.bounds.min[0]).toBeCloseTo(435, 0);

    // Placement-level plateIds: object 10 → plate 1, object 22 → plate 2.
    const obj10 = scene.objects.find((o) => o.id.endsWith('#10'))!;
    const obj22 = scene.objects.find((o) => o.id.endsWith('#22'))!;
    expect(obj10.plateIds).toEqual([1]);
    expect(obj22.plateIds).toEqual([2]);
  });

  it('a shared master spanning plates carries a plateId PER placement (refinement 1)', async () => {
    const scene = await parse3mf(
      makeZip([
        { name: '3D/3dmodel.model', data: enc(SHARED_MASTER_MODEL) },
        { name: 'Metadata/model_settings.config', data: enc(SHARED_MASTER_SETTINGS) }
      ])
    );
    expect(scene.capabilities.plates).toBe('known');
    // One unique master, two placements on two different plates — instanced, not duplicated.
    expect(scene.objects).toHaveLength(1);
    const master = scene.objects[0];
    expect(master.instances).toHaveLength(2);
    expect(master.plateIds).toEqual([1, 2]);
    // Each plate sees the one shared master once.
    expect(scene.plates!.list.map((p) => p.instanceCount)).toEqual([1, 1]);
    expect(scene.plates!.list.map((p) => p.objectCount)).toEqual([1, 1]);
  });

  it('a source with no plate declaration is honestly unavailable (no fabricated split)', async () => {
    const scene = await parse3mf(makeZip([{ name: '3D/3dmodel.model', data: enc(SINGLE_NO_SETTINGS) }]));
    expect(scene.capabilities.plates).toBe('unavailable');
    expect(scene.plates).toBeUndefined();
    expect(scene.objects[0].plateIds).toBeUndefined();
  });
});

// --- Bambu/Orca per-object extruder solid colour (maintainer-approved decode) ---

// Two objects, NO basematerials / colorgroup / paint_color — so without the extruder convention they would
// render neutral. The Baby_Opossum case (per-object/part extruder + project filament_colour palette).
const NO_MATERIAL_OBJECTS = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <object id="1" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
 <object id="2" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="8" y="0" z="0"/><vertex x="0" y="8" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
</resources><build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 30 0 0"/></build></model>`;

const FILAMENT_PALETTE = JSON.stringify({ filament_colour: ['#FF0000', '#00FF00'] }); // red slot0, green slot1
const EXTRUDER_SETTINGS = `<?xml version="1.0"?><config>
 <object id="1"><metadata key="extruder" value="1"/></object>
 <object id="2"><metadata key="extruder" value="2"/></object>
</config>`;

describe('parseObjectExtruders (Bambu colour convention)', () => {
  it('maps object AND part ids to 1-based extruder, part overriding its parent object', () => {
    const xml = `<config>
      <object id="10"><metadata key="extruder" value="1"/>
        <part id="1"><metadata key="extruder" value="1"/></part>
        <part id="9"><metadata key="extruder" value="2"/></part>
      </object>
    </config>`;
    const m = parseObjectExtruders(xml);
    expect(m.get('10')).toBe(1);
    expect(m.get('1')).toBe(1);
    expect(m.get('9')).toBe(2); // the part's own extruder, not the object default
  });

  it('is empty when no extruder metadata is declared', () => {
    expect(parseObjectExtruders('<config><object id="1"/></config>').size).toBe(0);
  });
});

describe('parse3mf per-object extruder colour (Bambu convention)', () => {
  it('colours each object from its extruder + the filament palette; materials becomes known', async () => {
    const scene = await parse3mf(
      makeZip([
        { name: '3D/3dmodel.model', data: enc(NO_MATERIAL_OBJECTS) },
        { name: 'Metadata/project_settings.config', data: enc(FILAMENT_PALETTE) },
        { name: 'Metadata/model_settings.config', data: enc(EXTRUDER_SETTINGS) }
      ])
    );
    expect(scene.capabilities.materials).toBe('known');
    const o1 = scene.objects.find((o) => o.id.endsWith('#1'))!;
    const o2 = scene.objects.find((o) => o.id.endsWith('#2'))!;
    // Linear-RGB of #FF0000 ≈ [1,0,0]; #00FF00 ≈ [0,1,0]. Assert the dominant channel per extruder slot.
    expect(o1.material?.color?.[0]).toBeGreaterThan(0.5);
    expect(o1.material?.color?.[1]).toBeLessThan(0.1);
    expect(o2.material?.color?.[1]).toBeGreaterThan(0.5);
    expect(o2.material?.color?.[0]).toBeLessThan(0.1);
  });

  it('stays neutral (unavailable) when the palette is absent — no fabricated colour', async () => {
    const scene = await parse3mf(
      makeZip([
        { name: '3D/3dmodel.model', data: enc(NO_MATERIAL_OBJECTS) },
        { name: 'Metadata/model_settings.config', data: enc(EXTRUDER_SETTINGS) } // extruder but NO palette
      ])
    );
    expect(scene.capabilities.materials).toBe('unavailable');
    expect(scene.objects.every((o) => o.material?.color === undefined)).toBe(true);
  });

  it('stays neutral when the source declares no extruder mapping', async () => {
    const scene = await parse3mf(
      makeZip([
        { name: '3D/3dmodel.model', data: enc(NO_MATERIAL_OBJECTS) },
        { name: 'Metadata/project_settings.config', data: enc(FILAMENT_PALETTE) } // palette but NO extruders
      ])
    );
    expect(scene.capabilities.materials).toBe('unavailable');
  });
});
