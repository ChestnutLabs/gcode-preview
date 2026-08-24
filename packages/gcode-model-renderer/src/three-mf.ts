/**
 * 3MF → {@link ModelScene} (DD-018 Phase 2). Multi-object, per-object/per-triangle **solid** colors,
 * build-item transforms — a multicolor model becomes a multicolor thumbnail without slicing.
 *
 * 3MF is an OPC (ZIP) package; the ZIP is opened with the hardened, zero-dep reader from
 * `@chestnutlabs/gcode-containers` (DD-005 §7 — zip-bomb / traversal / size caps reused verbatim). The
 * 3D model part is a small XML document parsed here with a minimal, worker-safe scan (no `DOMParser`,
 * which Web Workers lack; no dependency). Only the subset needed for a presentation render is read:
 * `<vertices>/<triangles>`, object/triangle material refs, `<basematerials>`/`<m:colorgroup>` palettes,
 * and `<build><item>` transforms. Textures and non-color material properties are ignored (disclosed via
 * capability honesty), never fetched (no network).
 */
import { readDirectory, extractEntry, DEFAULT_CONTAINER_LIMITS } from '@chestnutlabs/gcode-containers';
import {
  IDENTITY_MAT4,
  type MeshGeometry,
  type ModelBounds,
  type ModelObject,
  type ModelScene,
  type RGB
} from './scene-model.js';
import { ModelParseError, resolveLimits, type ModelLimits } from './limits.js';

/** millimeter is the 3MF default; convert others to mm. */
const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  meter: 1000,
  inch: 25.4,
  foot: 304.8
};

interface ParsedObject {
  name?: string;
  vertices: number[]; // flat xyz, indexed
  tris: number[]; // flat v1,v2,v3 per triangle
  triColorIdx: (readonly [number, number, number] | null)[]; // per-triangle [c1,c2,c3] palette indices, or null
  triPid: (string | null)[]; // per-triangle property group id (for palette lookup)
  objPid?: string;
  objPindex?: number;
}

const TAG_RE = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function localName(tag: string): string {
  const i = tag.indexOf(':');
  return i === -1 ? tag : tag.slice(i + 1);
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(s)) !== null) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

/** sRGB "#RRGGBB(AA)" → linear RGB in 0..1 (alpha ignored). Returns null on a malformed value. */
function srgbHexToLinear(hex: string): RGB | null {
  const h = hex.trim().replace(/^#/, '');
  if (h.length < 6) return null;
  const to = (o: number): number => {
    const c = parseInt(h.slice(o, o + 2), 16) / 255;
    if (Number.isNaN(c)) return NaN;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = to(0);
  const g = to(2);
  const b = to(4);
  return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : [r, g, b];
}

async function findModelXml(bytes: Uint8Array): Promise<Uint8Array> {
  const limits = DEFAULT_CONTAINER_LIMITS;
  const dir = readDirectory(bytes, limits);
  // Prefer the conventional path, then the OPC-declared StartPart, then any *.model.
  const byName = (pred: (n: string) => boolean): (typeof dir.entries)[number] | undefined =>
    dir.entries.find((e) => pred(e.name.toLowerCase()));
  let entry = byName((n) => n === '3d/3dmodel.model');
  if (entry === undefined) {
    const rels = byName((n) => n === '_rels/.rels');
    if (rels !== undefined) {
      const relXml = new TextDecoder().decode(await extractEntry(bytes, rels, limits.maxMetadataBytes));
      const target = /Target="\/?([^"]+\.model)"/i.exec(relXml)?.[1];
      if (target !== undefined) entry = byName((n) => n === target.toLowerCase());
    }
  }
  if (entry === undefined) entry = byName((n) => n.endsWith('.model'));
  if (entry === undefined) throw new ModelParseError('E_MODEL_PARSE', '3MF contains no 3D model part');
  return extractEntry(bytes, entry, limits.maxExpandedBytesPerEntry);
}

/** Parse 3MF bytes into a {@link ModelScene}. Rejects with {@link ModelParseError} on failure. */
export async function parse3mf(source: Uint8Array | ArrayBuffer, limits?: ModelLimits): Promise<ModelScene> {
  const lim = resolveLimits(limits);
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.byteLength === 0) throw new ModelParseError('E_MODEL_EMPTY', '3MF source is empty');
  if (bytes.byteLength > lim.maxSourceBytes) {
    throw new ModelParseError(
      'E_MODEL_TOO_LARGE',
      `3MF source ${bytes.byteLength} bytes exceeds limit ${lim.maxSourceBytes}`
    );
  }

  let xml: string;
  try {
    xml = new TextDecoder().decode(await findModelXml(bytes));
  } catch (e) {
    if (e instanceof ModelParseError) throw e;
    throw new ModelParseError('E_MODEL_PARSE', `3MF unzip failed: ${(e as Error).message}`);
  }

  // Single scan over the model XML.
  let unitScale = 1;
  const palettes = new Map<string, RGB[]>(); // resource id → colors
  const objects = new Map<string, ParsedObject>();
  const items: { objectid: string; transform?: string }[] = [];

  let curObj: ParsedObject | null = null;
  let curObjId: string | null = null;
  let curPaletteId: string | null = null;
  let inBuild = false;

  TAG_RE.lastIndex = 0;
  let t: RegExpExecArray | null;
  while ((t = TAG_RE.exec(xml)) !== null) {
    const closing = t[1] === '/';
    const name = localName(t[2]);
    const selfClose = t[4] === '/';
    const raw = t[3];

    if (name === 'model' && !closing) {
      const u = attrs(raw).unit;
      if (u !== undefined && UNIT_TO_MM[u] !== undefined) unitScale = UNIT_TO_MM[u];
    } else if (name === 'basematerials' || name === 'colorgroup') {
      if (closing) curPaletteId = null;
      else {
        curPaletteId = attrs(raw).id ?? null;
        if (curPaletteId !== null) palettes.set(curPaletteId, []);
      }
    } else if ((name === 'base' || name === 'color') && curPaletteId !== null) {
      const a = attrs(raw);
      const c = srgbHexToLinear(a.displaycolor ?? a.color ?? '');
      const arr = palettes.get(curPaletteId);
      if (arr !== undefined) arr.push(c ?? [0.8, 0.8, 0.82]);
    } else if (name === 'object') {
      if (closing) {
        if (curObj !== null && curObjId !== null) objects.set(curObjId, curObj);
        curObj = null;
        curObjId = null;
      } else {
        const a = attrs(raw);
        curObjId = a.id ?? null;
        curObj = { vertices: [], tris: [], triColorIdx: [], triPid: [], name: a.name };
        if (a.pid !== undefined) curObj.objPid = a.pid;
        if (a.pindex !== undefined) curObj.objPindex = Number(a.pindex);
        if (selfClose) {
          curObj = null;
          curObjId = null;
        }
      }
    } else if (name === 'vertex' && curObj !== null) {
      const a = attrs(raw);
      curObj.vertices.push(Number(a.x) || 0, Number(a.y) || 0, Number(a.z) || 0);
    } else if (name === 'triangle' && curObj !== null) {
      const a = attrs(raw);
      curObj.tris.push(Number(a.v1) | 0, Number(a.v2) | 0, Number(a.v3) | 0);
      if (curObj.tris.length / 3 > lim.maxTriangles) {
        throw new ModelParseError('E_MODEL_TOO_MANY_TRIANGLES', `3MF exceeds triangle limit ${lim.maxTriangles}`);
      }
      const pid = a.pid ?? curObj.objPid ?? null;
      curObj.triPid.push(pid);
      // Per-vertex color indices p1/p2/p3 (fall back to p1 for all, then object pindex).
      if (a.p1 !== undefined) {
        const p1 = Number(a.p1);
        const p2 = a.p2 !== undefined ? Number(a.p2) : p1;
        const p3 = a.p3 !== undefined ? Number(a.p3) : p1;
        curObj.triColorIdx.push([p1, p2, p3]);
      } else if (curObj.objPindex !== undefined) {
        const p = curObj.objPindex;
        curObj.triColorIdx.push([p, p, p]);
      } else {
        curObj.triColorIdx.push(null);
      }
    } else if (name === 'build') {
      inBuild = !closing;
    } else if (name === 'item' && inBuild && !closing) {
      const a = attrs(raw);
      if (a.objectid !== undefined) items.push({ objectid: a.objectid, transform: a.transform });
    }
  }

  return assemble(objects, palettes, items, unitScale, lim.maxTriangles);
}

function parseTransform(s: string | undefined): number[] | null {
  if (s === undefined) return null;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every((n) => !Number.isNaN(n)) ? v : null;
}

/** Apply a 3MF row-vector affine (12 values) to a point. */
function applyTransform(v: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    v[0] * x + v[3] * y + v[6] * z + v[9],
    v[1] * x + v[4] * y + v[7] * z + v[10],
    v[2] * x + v[5] * y + v[8] * z + v[11]
  ];
}

function assemble(
  objects: Map<string, ParsedObject>,
  palettes: Map<string, RGB[]>,
  items: { objectid: string; transform?: string }[],
  unitScale: number,
  maxTriangles: number
): ModelScene {
  // With no <build>, render every declared object at identity (some minimal 3MFs omit build).
  const instances =
    items.length > 0 ? items : [...objects.keys()].map((objectid) => ({ objectid, transform: undefined }));

  const built: ModelObject[] = [];
  let anyColor = false;
  let anyTransform = false;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let totalTris = 0;

  for (const inst of instances) {
    const obj = objects.get(inst.objectid);
    if (obj === undefined || obj.tris.length === 0) continue;
    const xform = parseTransform(inst.transform);
    if (xform !== null) anyTransform = true;

    const triCount = obj.tris.length / 3;
    totalTris += triCount;
    if (totalTris > maxTriangles)
      throw new ModelParseError('E_MODEL_TOO_MANY_TRIANGLES', `3MF exceeds triangle limit ${maxTriangles}`);

    // Expand to a non-indexed mesh (per-triangle colors need independent vertices).
    const positions = new Float32Array(triCount * 9);
    let colors: Float32Array | null = null;
    let objHasColor = false;
    for (let ti = 0; ti < triCount; ti++) {
      const pid = obj.triPid[ti];
      const palette = pid !== null ? palettes.get(pid) : undefined;
      const cidx = obj.triColorIdx[ti];
      for (let k = 0; k < 3; k++) {
        const vi = obj.tris[ti * 3 + k] * 3;
        let x = obj.vertices[vi] * unitScale;
        let y = obj.vertices[vi + 1] * unitScale;
        let z = obj.vertices[vi + 2] * unitScale;
        if (xform !== null) [x, y, z] = applyTransform(xform, x, y, z);
        const o = (ti * 3 + k) * 3;
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
        if (x < min[0]) min[0] = x;
        if (y < min[1]) min[1] = y;
        if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x;
        if (y > max[1]) max[1] = y;
        if (z > max[2]) max[2] = z;
        if (palette !== undefined && cidx !== null) {
          const col = palette[cidx[k]] ?? palette[0];
          if (col !== undefined) {
            if (colors === null) colors = new Float32Array(triCount * 9);
            colors[o] = col[0];
            colors[o + 1] = col[1];
            colors[o + 2] = col[2];
            objHasColor = true;
          }
        }
      }
    }
    if (objHasColor) anyColor = true;

    const geometry: MeshGeometry = colors !== null ? { positions, colors } : { positions };
    const built1: ModelObject = { id: inst.objectid, geometry, transform: IDENTITY_MAT4 };
    if (obj.name !== undefined) built1.name = obj.name;
    built.push(built1);
  }

  if (built.length === 0) throw new ModelParseError('E_MODEL_EMPTY', '3MF contains no renderable geometry');

  const bounds: ModelBounds = { min, max };
  return {
    objects: built,
    bounds,
    capabilities: {
      materials: anyColor ? 'known' : 'unavailable',
      transforms: anyTransform ? 'known' : 'unavailable',
      multiObject: built.length > 1 ? 'known' : 'unavailable'
    }
  };
}
