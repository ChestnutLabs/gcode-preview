import { describe, it, expect } from 'vitest';
import { parse3mf } from '../three-mf.js';
import { renderModelStill } from '../render-model-still.js';
import { ModelParseError } from '../limits.js';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';

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
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
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
function threeMf(modelXml: string): Uint8Array {
  return makeZip([{ name: '3D/3dmodel.model', data: new TextEncoder().encode(modelXml) }]);
}

const SINGLE = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <object id="1" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="20" z="0"/><vertex x="0" y="0" z="5"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="3"/></triangles>
 </mesh></object>
</resources><build><item objectid="1"/></build></model>`;

const MULTICOLOR_OBJECTS = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <basematerials id="5"><base name="black" displaycolor="#000000"/><base name="orange" displaycolor="#FF8000"/></basematerials>
 <object id="1" pid="5" pindex="0"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="5" y="0" z="0"/><vertex x="0" y="5" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
 <object id="2" pid="5" pindex="1"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="5" y="0" z="0"/><vertex x="0" y="5" z="0"/></vertices>
  <triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
</resources><build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 30 0 0"/></build></model>`;

const PER_TRIANGLE_COLOR = `<?xml version="1.0"?>
<model unit="millimeter"><resources>
 <basematerials id="5"><base displaycolor="#FF0000"/><base displaycolor="#00FF00"/></basematerials>
 <object id="1"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices>
  <triangles>
   <triangle v1="0" v2="1" v3="2" pid="5" p1="0" p2="0" p3="0"/>
   <triangle v1="0" v2="1" v3="3" pid="5" p1="1" p2="1" p3="1"/>
  </triangles></mesh></object>
</resources><build><item objectid="1"/></build></model>`;

function stubCanvas(): RenderTargetCanvas {
  return { width: 128, height: 128 } as unknown as RenderTargetCanvas;
}
function stubGL(canvas: RenderTargetCanvas): GLRendererLike {
  return { render: () => undefined, setSize: () => undefined, dispose: () => undefined, domElement: canvas };
}

describe('parse3mf', () => {
  it('single object, no color → honest unavailable materials + correct bounds', async () => {
    const scene = await parse3mf(threeMf(SINGLE));
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0].geometry.positions).toHaveLength(2 * 9); // 2 tris, non-indexed
    expect(scene.objects[0].geometry.colors).toBeUndefined();
    expect(scene.capabilities.materials).toBe('unavailable');
    expect(scene.bounds.min).toEqual([0, 0, 0]);
    expect(scene.bounds.max[0]).toBeCloseTo(10);
    expect(scene.bounds.max[1]).toBeCloseTo(20);
    expect(scene.bounds.max[2]).toBeCloseTo(5);
  });

  it('multi-object with per-object colors + a build transform', async () => {
    const scene = await parse3mf(threeMf(MULTICOLOR_OBJECTS));
    expect(scene.objects).toHaveLength(2);
    expect(scene.capabilities).toMatchObject({ materials: 'known', multiObject: 'known', transforms: 'known' });
    // Each object carries a (uniform) color buffer from its material.
    expect(scene.objects[0].geometry.colors).toBeInstanceOf(Float32Array);
    expect(scene.objects[1].geometry.colors).toBeInstanceOf(Float32Array);
    // Object 2 is translated +30 in X by the build item transform.
    expect(scene.bounds.max[0]).toBeCloseTo(35);
    // Object 1 is black (linear 0), object 2 orange (r>g>0) — colors are honest, not fabricated.
    expect(Array.from(scene.objects[0].geometry.colors!.slice(0, 3))).toEqual([0, 0, 0]);
    const o2 = scene.objects[1].geometry.colors!;
    expect(o2[0]).toBeGreaterThan(o2[1]); // orange: R > G
    expect(o2[2]).toBeCloseTo(0);
  });

  it('single mesh with per-triangle colors → one object, a vertex-color buffer, materials known', async () => {
    const scene = await parse3mf(threeMf(PER_TRIANGLE_COLOR));
    expect(scene.objects).toHaveLength(1);
    expect(scene.capabilities.materials).toBe('known');
    const c = scene.objects[0].geometry.colors!;
    expect(c).toBeInstanceOf(Float32Array);
    // Triangle 0 red (first 9 floats), triangle 1 green (next 9).
    expect(c[0]).toBeGreaterThan(0.9); // R of tri0 vertex0 (linear of #FF ≈ 1)
    expect(c[1]).toBeCloseTo(0);
    expect(c[9 + 1]).toBeGreaterThan(0.9); // G of tri1 vertex0
    expect(c[9]).toBeCloseTo(0);
  });

  it('rejects empty input', async () => {
    await expect(parse3mf(new Uint8Array(0))).rejects.toBeInstanceOf(ModelParseError);
  });
});

describe('renderModelStill (3mf)', () => {
  it('renders a multicolor 3MF → materials known, multi-object', async () => {
    const res = await renderModelStill(
      { kind: '3mf', bytes: threeMf(MULTICOLOR_OBJECTS) },
      { canvas: stubCanvas(), createRenderer: stubGL }
    );
    expect(res.objectCount).toBe(2);
    expect(res.materials).toBe('known');
    expect(res.cacheKey.startsWith('mr1_')).toBe(true);
  });
});
