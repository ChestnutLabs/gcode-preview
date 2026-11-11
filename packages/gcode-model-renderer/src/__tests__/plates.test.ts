/**
 * DD-025 — multi-plate model structure. Tests the Bambu/Orca `model_settings.config` plate parser and the
 * `ModelScene.plates` / placement-level `plateIds` / `capabilities.plates` exposure. All fixtures are fully
 * synthetic and MIT-clean (clean-room from the observed `<plate>` format, parity with the RR-005 approach).
 * The linear scanners were proven equivalent to the pre-#468 regexes by a differential oracle + seeded fuzz,
 * in history at #473 (6bfe00a) and #475 (35b7381); the literal cases below are now the spec.
 */
import { describe, it, expect } from 'vitest';
import { parse3mf } from '../three-mf.js';

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

const PID = (n: number): string => `<metadata key="plater_id" value="${n}"/>`;
const MI = (obj: number, ins: number): string =>
  `<model_instance><metadata key="object_id" value="${obj}"/><metadata key="instance_id" value="${ins}"/></model_instance>`;

// --- plate-config cases are driven through the public `parse3mf` (the module-private parsePlateConfig's only
// caller). A model of tiny triangle meshes is built, one build item per entry of `itemIds` (object id), so the
// Nth item of object X is placement `X#N` in the declared `<plate>` config. Observables: `scene.plates.list`
// (order / names / per-plate instance counts) and each object's per-placement `plateIds` (a placement the config
// does not list falls back to the FIRST declared plate, so unmapped placements are asserted explicitly).
const meshObject = (id: number | string): string =>
  `<object id="${id}" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;
const modelFor = (itemIds: (number | string)[]): string =>
  `<?xml version="1.0"?><model unit="millimeter"><resources>${[...new Set(itemIds)].map(meshObject).join('')}</resources><build>${itemIds
    .map((id, i) => `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${i * 100} 0 0"/>`)
    .join('')}</build></model>`;
const parseWithSettings = (
  config: string,
  itemIds: (number | string)[],
  extra: { name: string; data: Uint8Array }[] = []
) =>
  parse3mf(
    makeZip([
      { name: '3D/3dmodel.model', data: enc(modelFor(itemIds)) },
      { name: 'Metadata/model_settings.config', data: enc(config) },
      ...extra
    ])
  );

async function plateView(config: string, itemIds: number[]) {
  const scene = await parseWithSettings(config, itemIds);
  if (scene.plates === undefined) {
    expect(scene.capabilities.plates).toBe('unavailable');
    return null;
  }
  expect(scene.capabilities.plates).toBe('known');
  const list = scene.plates.list;
  const plateIds: Record<string, number[]> = {};
  for (const o of scene.objects) plateIds[o.id.split('#').pop()!] = o.plateIds ?? [];
  return {
    order: list.map((p) => p.id),
    names: list.filter((p) => p.name !== undefined).map((p) => [p.id, p.name]),
    instances: list.map((p) => p.instanceCount),
    plateIds
  };
}

describe('plate config via parse3mf (DD-025)', () => {
  it('maps each model_instance (object_id#instance_id) to its plate, with names and order', async () => {
    expect(await plateView(TWO_PLATE_SETTINGS, [10, 22])).toEqual({
      order: [1, 2],
      names: [[1, 'Plate A']], // empty plater_name is not recorded
      instances: [1, 1],
      plateIds: { 10: [1], 22: [2] }
    });
  });

  it('is unavailable (no plates) when no <plate> is declared', async () => {
    expect(await plateView('<config><object id="1"/></config>', [1])).toBeNull();
    expect(await plateView('not xml at all', [1])).toBeNull();
    expect(await plateView('', [1])).toBeNull();
  });

  it('parses a multi-plate config to the exact expected structure (placement ordinal keys the instance)', async () => {
    const config = `<?xml version="1.0"?><config>
  <plate>${PID(1)}<metadata key="plater_name" value="A"/>${MI(10, 0)}${MI(10, 1)}</plate>
  <plate>${PID(2)}${MI(11, 0)}</plate>
  <plate>${PID(5)}<metadata key="plater_name" value="E"/>${MI(12, 3)}</plate>
</config>`;
    // 12#0..12#2 are unlisted � fall back to the first declared plate (1); only the 4th placement (12#3) is plate 5.
    expect(await plateView(config, [10, 10, 11, 12, 12, 12, 12])).toEqual({
      order: [1, 2, 5],
      names: [
        [1, 'A'],
        [5, 'E']
      ],
      instances: [5, 1, 1],
      plateIds: { 10: [1, 1], 11: [2], 12: [1, 1, 1, 5] }
    });
  });

  it('a plate with no plater_id is skipped; a model_instance needs BOTH object_id and instance_id', async () => {
    expect(
      (
        await plateView(`<plate><metadata key="plater_name" value="x"/></plate><plate>${PID(2)}${MI(10, 0)}</plate>`, [
          10
        ])
      )?.order
    ).toEqual([2]);
    const half = `<model_instance><metadata key="object_id" value="11"/></model_instance>`;
    // 11 is only half-declared on plate 2 � unmapped � first plate (1), not 2.
    expect(
      (await plateView(`<plate>${PID(1)}${MI(10, 0)}</plate><plate>${PID(2)}${half}</plate>`, [10, 11]))?.plateIds
    ).toEqual({
      10: [1],
      11: [1]
    });
  });

  it('keeps the word boundary: <plates> and <plate_x> are not plates, <plate id="9"> is', async () => {
    expect(await plateView(`<plates>${PID(7)}</plate>`, [1])).toBeNull();
    expect(await plateView(`<plate_x>${PID(7)}</plate>`, [1])).toBeNull();
    expect((await plateView(`<plate id="9">${PID(7)}</plate>`, [1]))?.order).toEqual([7]);
    expect((await plateView(`<plate>${PID(8)}</plate>`, [1]))?.order).toEqual([8]);
  });

  it('is case-insensitive on the open tag and on the close tag independently', async () => {
    expect((await plateView(`<PLATE>${PID(3)}</plate>`, [1]))?.order).toEqual([3]);
    expect((await plateView(`<plate>${PID(4)}</PLATE>`, [1]))?.order).toEqual([4]);
    expect((await plateView(`<Plate>${PID(6)}</Plate>`, [1]))?.order).toEqual([6]);
  });

  it('takes non-overlapping blocks: a plate opened inside another belongs to the outer block', async () => {
    expect(await plateView(`<plate>${PID(1)}<plate>${PID(2)}${MI(3, 0)}</plate>`, [3])).toEqual({
      order: [1],
      names: [],
      instances: [1],
      plateIds: { 3: [1] }
    });
    expect((await plateView(`<plate>${PID(1)}</plate><plate>${PID(2)}</plate>`, [1]))?.order).toEqual([1, 2]);
  });

  it('keeps the plates already closed when a later <plate> never closes', async () => {
    // 11 would be on plate 2 if the unclosed block were read; it is unlisted � plate 1.
    expect(await plateView(`<plate>${PID(1)}${MI(10, 0)}</plate><plate>${PID(2)}${MI(11, 0)}`, [10, 11])).toEqual({
      order: [1],
      names: [],
      instances: [2],
      plateIds: { 10: [1], 11: [1] }
    });
  });

  it('keeps the model_instances already closed when a later one never closes', async () => {
    const open = '<model_instance><metadata key="object_id" value="11"/><metadata key="instance_id" value="0"/>';
    // 12#0 (closed, plate 2) is kept; 11#0 (never closed, would be plate 2) is unmapped � plate 1.
    expect(
      await plateView(`<plate>${PID(1)}${MI(10, 0)}</plate><plate>${PID(2)}${MI(12, 0)}${open}</plate>`, [10, 11, 12])
    ).toEqual({
      order: [1, 2],
      names: [],
      instances: [2, 1],
      plateIds: { 10: [1], 11: [1], 12: [2] }
    });
  });

  it('returns promptly on 1 MiB of unclosed <plate opens', async () => {
    const xml = '<plate '.repeat(Math.ceil(1_048_576 / 7));
    const t0 = performance.now();
    const pv = await plateView(xml, [1]);
    const ms = performance.now() - t0;
    expect(pv).toBeNull();
    expect(ms).toBeLessThan(2000);
  }, 20_000);

  it('returns promptly on 1 MiB of unclosed <model_instance opens inside a closed plate', async () => {
    const xml = `<plate>${PID(1)}${'<model_instance '.repeat(65_536)}</plate>`;
    const t0 = performance.now();
    const pv = await plateView(xml, [1]);
    const ms = performance.now() - t0;
    expect(pv).toEqual({ order: [1], names: [], instances: [1], plateIds: { 1: [1] } });
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

// parseObjectExtruders (module-private) is driven through `parse3mf`: with a `filament_colour` palette whose
// slot N is a pure-channel colour, an object whose config extruder is N comes out with that literal colour.
const EXT_PALETTE = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF'];
const RED: number[] = [1, 0, 0];
const GREEN: number[] = [0, 1, 0];
const BLUE: number[] = [0, 0, 1];
const YELLOW: number[] = [1, 1, 0];
const CYAN: number[] = [0, 1, 1];
const EX = (n: number): string => `<metadata key="extruder" value="${n}"/>`;

/** Colour (or `undefined` = neutral) of each object id after resolving `config`'s extruders against EXT_PALETTE. */
async function extruderColors(config: string, ids: (number | string)[]): Promise<Record<string, number[] | undefined>> {
  const scene = await parseWithSettings(config, ids, [
    { name: 'Metadata/project_settings.config', data: enc(JSON.stringify({ filament_colour: EXT_PALETTE })) }
  ]);
  const out: Record<string, number[] | undefined> = {};
  for (const o of scene.objects) {
    const c = o.material?.color;
    out[o.id.split('#').pop()!] = c === undefined ? undefined : Array.from(c);
  }
  return out;
}

describe('per-object extruder resolution via parse3mf (Bambu colour convention, #468 linear scan)', () => {
  it('maps object AND part ids to 1-based extruder, part overriding its parent object', async () => {
    const xml = `<config>
      <object id="10"><metadata key="extruder" value="1"/>
        <part id="1"><metadata key="extruder" value="1"/></part>
        <part id="9"><metadata key="extruder" value="2"/></part>
      </object>
    </config>`;
    expect(await extruderColors(xml, [10, 1, 9])).toEqual({ 10: RED, 1: RED, 9: GREEN });
  });

  it('is neutral when no extruder metadata is declared', async () => {
    expect(await extruderColors('<config><object id="1"/></config>', [1])).toEqual({ 1: undefined });
    expect(await extruderColors('', [1])).toEqual({ 1: undefined });
  });

  it('maps objects and parts to their own extruder in a multi-object config', async () => {
    const xml = `<config>
 <object id="10">${EX(1)}<part id="1">${EX(1)}</part><part id="9">${EX(2)}</part></object>
 <object id="11">${EX(3)}</object>
</config>`;
    expect(await extruderColors(xml, [1, 9, 10, 11])).toEqual({ 1: RED, 9: GREEN, 10: RED, 11: BLUE });
  });

  it('ends a segment at the next part header (object without its own extruder gets none)', async () => {
    expect(await extruderColors(`<object id="5"><part id="6">${EX(2)}</part></object>`, [5, 6])).toEqual({
      5: undefined,
      6: GREEN
    });
  });

  it('ends a segment at </config>, and still reads objects declared after it', async () => {
    expect(await extruderColors(`<object id="1"></config>${EX(2)}`, [1])).toEqual({ 1: undefined });
    expect(await extruderColors(`<object id="1">${EX(1)}</config><object id="2">${EX(2)}`, [1, 2])).toEqual({
      1: RED,
      2: GREEN
    });
  });

  it('runs the last segment to the end of the input', async () => {
    expect(await extruderColors(`<object id="1">${EX(3)}`, [1])).toEqual({ 1: BLUE });
  });

  it('takes a header tag to the first > after the id, even across a later header prefix', async () => {
    expect(await extruderColors(`<object id="1" <object id="2">${EX(4)}`, [1, 2])).toEqual({
      1: YELLOW,
      2: undefined
    });
    expect(await extruderColors(`<object id="1" name="a>b">${EX(2)}`, [1])).toEqual({ 1: GREEN });
  });

  it('keeps earlier results when a later header has no > at all', async () => {
    expect(await extruderColors(`<object id="1">${EX(2)}<object id="3" `, [1, 3])).toEqual({
      1: GREEN,
      3: undefined
    });
  });

  it('ends a segment at a non-numeric-id header prefix without reading it as a header', async () => {
    expect(await extruderColors(`<object id="1"><object id="x">${EX(2)}</object>`, [1, 'x'])).toEqual({
      1: undefined,
      x: undefined
    });
  });

  it('is case-sensitive on headers, header prefixes and </config>', async () => {
    expect(await extruderColors(`<OBJECT id="1">${EX(2)}`, [1])).toEqual({ 1: undefined });
    expect(await extruderColors(`<object id="1"><OBJECT id="2">${EX(4)}`, [1, 2])).toEqual({ 1: YELLOW, 2: undefined });
    expect(await extruderColors(`<object id="1"></CONFIG>${EX(4)}`, [1])).toEqual({ 1: YELLOW });
  });

  it('accepts any whitespace between the tag name and id (headers and segment ends)', async () => {
    expect(await extruderColors(`<object\n id="1">\n<part\tid="2">${EX(5)}`, [1, 2])).toEqual({
      1: undefined,
      2: CYAN
    });
  });

  it('uses only the FIRST extruder of a segment; extruder 0 and out-of-palette slots stay neutral', async () => {
    expect(await extruderColors(`<object id="1">${EX(0)}${EX(2)}<object id="2">${EX(3)}${EX(4)}`, [1, 2])).toEqual({
      1: undefined,
      2: BLUE
    });
    expect(await extruderColors(`<object id="1">${EX(7)}`, [1])).toEqual({ 1: undefined });
  });

  it('returns promptly on 1 MiB of object headers that never close', async () => {
    const xml = '<object id="1" '.repeat(69_906);
    const t0 = performance.now();
    const colors = await extruderColors(xml, [1]);
    const ms = performance.now() - t0;
    expect(colors).toEqual({ 1: undefined });
    expect(ms).toBeLessThan(2000);
  }, 20_000);
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
