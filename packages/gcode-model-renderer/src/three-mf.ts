/**
 * 3MF → {@link ModelScene} (DD-018 Phase 2, + production-extension follow-up). Multi-object,
 * per-object/per-triangle **solid** colors, build-item transforms, and the **3MF Production Extension**
 * (Bambu/MakerWorld default): `<components>` whose `<component p:path=…>` reference external
 * `/3D/Objects/*.model` parts. A multicolor model becomes a multicolor thumbnail without slicing.
 *
 * 3MF is an OPC (ZIP) package; the ZIP is opened with the hardened, zero-dep reader from
 * `@chestnutlabs/gcode-containers` (DD-005 §7 — zip-bomb / traversal / size caps reused verbatim). Each
 * model part is a small XML document parsed with a minimal, worker-safe scan (no `DOMParser`, which Web
 * Workers lack; no dependency). Only the subset needed for a presentation render is read:
 * `<vertices>/<triangles>`, object/triangle material refs, `<basematerials>`/`<m:colorgroup>` palettes,
 * `<components><component>` (with `p:path`), and `<build><item>` transforms. Textures and non-color
 * material properties are ignored (disclosed via capability honesty), never fetched (no network).
 */
import {
  readDirectory,
  extractEntry,
  DEFAULT_CONTAINER_LIMITS,
  type ZipDirectory
} from '@chestnutlabs/gcode-containers';
import {
  IDENTITY_MAT4,
  type MeshGeometry,
  type ModelBounds,
  type ModelObject,
  type ModelScene,
  type RGB
} from './scene-model.js';
import { ModelParseError, resolveLimits, type ModelLimits, type ResolvedLimits } from './limits.js';

/** millimeter is the 3MF default; convert others to mm. */
const UNIT_TO_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  meter: 1000,
  inch: 25.4,
  foot: 304.8
};

/** Max component-resolution depth (guards cyclic / pathological assemblies). */
const MAX_DEPTH = 50;

interface Component {
  /** Absolute OPC path to an external model part (production extension), or undefined = same part. */
  path?: string;
  objectid: string;
  transform: number[] | null;
}

interface ParsedObject {
  name?: string;
  vertices: number[]; // flat xyz, indexed
  tris: number[]; // flat v1,v2,v3 per triangle
  triColorIdx: (readonly [number, number, number] | null)[]; // per-triangle [c1,c2,c3] palette indices, or null
  triPid: (string | null)[]; // per-triangle property group id (for palette lookup)
  components: Component[]; // production-extension sub-assemblies
  objPid?: string;
  objPindex?: number;
}

interface ModelPart {
  objects: Map<string, ParsedObject>;
  palettes: Map<string, RGB[]>; // resource id → colors
  unitScale: number;
  items: { objectid: string; transform: number[] | null }[];
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

/** Apply a chain of transforms in order (innermost first): comp → … → build item. */
function applyChain(chain: number[][], x: number, y: number, z: number): [number, number, number] {
  let p: [number, number, number] = [x, y, z];
  for (const t of chain) p = applyTransform(t, p[0], p[1], p[2]);
  return p;
}

/** Parse ONE model part's XML into objects/palettes/items (no cross-part resolution). */
function parseModelPart(xml: string, lim: ResolvedLimits): ModelPart {
  let unitScale = 1;
  const palettes = new Map<string, RGB[]>();
  const objects = new Map<string, ParsedObject>();
  const items: { objectid: string; transform: number[] | null }[] = [];

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
        curObj = { vertices: [], tris: [], triColorIdx: [], triPid: [], components: [], name: a.name };
        if (a.pid !== undefined) curObj.objPid = a.pid;
        if (a.pindex !== undefined) curObj.objPindex = Number(a.pindex);
        if (selfClose) {
          curObj = null;
          curObjId = null;
        }
      }
    } else if (name === 'component' && curObj !== null) {
      // Production extension: a sub-object, possibly in an external part via `p:path` (any prefix).
      const a = attrs(raw);
      const path = a['p:path'] ?? a.path;
      if (a.objectid !== undefined) {
        curObj.components.push({
          ...(path !== undefined ? { path } : {}),
          objectid: a.objectid,
          transform: parseTransform(a.transform)
        });
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
      if (a.objectid !== undefined) items.push({ objectid: a.objectid, transform: parseTransform(a.transform) });
    }
  }
  return { objects, palettes, unitScale, items };
}

/** Accumulators threaded through the recursive resolve. */
interface BuildState {
  built: ModelObject[];
  anyColor: boolean;
  anyTransform: boolean;
  min: [number, number, number];
  max: [number, number, number];
  totalTris: number;
}

/** Bake one mesh object (its own triangles) into a `ModelObject`, applying the transform chain. */
function bakeMesh(
  obj: ParsedObject,
  part: ModelPart,
  chain: number[][],
  id: string,
  st: BuildState,
  lim: ResolvedLimits
): void {
  const triCount = obj.tris.length / 3;
  st.totalTris += triCount;
  if (st.totalTris > lim.maxTriangles) {
    throw new ModelParseError('E_MODEL_TOO_MANY_TRIANGLES', `3MF exceeds triangle limit ${lim.maxTriangles}`);
  }
  const positions = new Float32Array(triCount * 9);
  let colors: Float32Array | null = null;
  let objHasColor = false;
  for (let ti = 0; ti < triCount; ti++) {
    const pid = obj.triPid[ti];
    const palette = pid !== null ? part.palettes.get(pid) : undefined;
    const cidx = obj.triColorIdx[ti];
    for (let k = 0; k < 3; k++) {
      const vi = obj.tris[ti * 3 + k] * 3;
      const [x, y, z] = applyChain(
        chain,
        obj.vertices[vi] * part.unitScale,
        obj.vertices[vi + 1] * part.unitScale,
        obj.vertices[vi + 2] * part.unitScale
      );
      const o = (ti * 3 + k) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      if (x < st.min[0]) st.min[0] = x;
      if (y < st.min[1]) st.min[1] = y;
      if (z < st.min[2]) st.min[2] = z;
      if (x > st.max[0]) st.max[0] = x;
      if (y > st.max[1]) st.max[1] = y;
      if (z > st.max[2]) st.max[2] = z;
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
  if (objHasColor) st.anyColor = true;
  const geometry: MeshGeometry = colors !== null ? { positions, colors } : { positions };
  const built: ModelObject = { id, geometry, transform: IDENTITY_MAT4 };
  if (obj.name !== undefined) built.name = obj.name;
  st.built.push(built);
}

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

  const climits = DEFAULT_CONTAINER_LIMITS;
  let dir: ZipDirectory;
  try {
    dir = readDirectory(bytes, climits);
  } catch (e) {
    throw new ModelParseError('E_MODEL_PARSE', `3MF unzip failed: ${(e as Error).message}`);
  }
  const entryByName = (nameLower: string): ZipDirectory['entries'][number] | undefined =>
    dir.entries.find((e) => e.name.toLowerCase() === nameLower);

  // Locate the primary model part: conventional path, then OPC StartPart, then any *.model.
  let mainEntry = entryByName('3d/3dmodel.model');
  if (mainEntry === undefined) {
    const rels = entryByName('_rels/.rels');
    if (rels !== undefined) {
      const relXml = new TextDecoder().decode(await extractEntry(bytes, rels, climits.maxMetadataBytes));
      const target = /Target="\/?([^"]+\.model)"/i.exec(relXml)?.[1];
      if (target !== undefined) mainEntry = entryByName(target.toLowerCase());
    }
  }
  if (mainEntry === undefined) mainEntry = dir.entries.find((e) => e.name.toLowerCase().endsWith('.model'));
  if (mainEntry === undefined) throw new ModelParseError('E_MODEL_PARSE', '3MF contains no 3D model part');

  // Lazily parse model parts by absolute OPC path (production-extension components reference them).
  const partCache = new Map<string, ModelPart>();
  const parseEntry = async (entry: ZipDirectory['entries'][number]): Promise<ModelPart> => {
    const key = entry.name.toLowerCase();
    const cached = partCache.get(key);
    if (cached !== undefined) return cached;
    const xml = new TextDecoder().decode(await extractEntry(bytes, entry, climits.maxExpandedBytesPerEntry));
    const part = parseModelPart(xml, lim);
    partCache.set(key, part);
    return part;
  };
  const getPartByPath = async (path: string): Promise<ModelPart | null> => {
    const norm = path.replace(/^\//, '').toLowerCase();
    const entry = entryByName(norm);
    return entry === undefined ? null : parseEntry(entry);
  };

  let mainPart: ModelPart;
  try {
    mainPart = await parseEntry(mainEntry);
  } catch (e) {
    if (e instanceof ModelParseError) throw e;
    throw new ModelParseError('E_MODEL_PARSE', `3MF unzip failed: ${(e as Error).message}`);
  }

  const st: BuildState = {
    built: [],
    anyColor: false,
    anyTransform: false,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    totalTris: 0
  };

  // Resolve an object (mesh and/or components) within `part`, applying the transform chain.
  const resolve = async (
    part: ModelPart,
    objectid: string,
    chain: number[][],
    id: string,
    depth: number
  ): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    const obj = part.objects.get(objectid);
    if (obj === undefined) return;
    if (obj.tris.length > 0) bakeMesh(obj, part, chain, id, st, lim);
    for (let ci = 0; ci < obj.components.length; ci++) {
      const comp = obj.components[ci];
      const targetPart = comp.path !== undefined ? await getPartByPath(comp.path) : part;
      if (targetPart === null) continue;
      // Apply the component transform FIRST (child space → this object), then the existing chain.
      const childChain = comp.transform !== null ? [comp.transform, ...chain] : chain;
      if (comp.transform !== null) st.anyTransform = true;
      await resolve(targetPart, comp.objectid, childChain, `${id}.${ci}`, depth + 1);
    }
  };

  // With no <build>, resolve every declared object at identity (some minimal 3MFs omit build).
  const instances =
    mainPart.items.length > 0
      ? mainPart.items
      : [...mainPart.objects.keys()].map((objectid) => ({ objectid, transform: null }));
  for (const inst of instances) {
    const chain = inst.transform !== null ? [inst.transform] : [];
    if (inst.transform !== null) st.anyTransform = true;
    await resolve(mainPart, inst.objectid, chain, inst.objectid, 0);
  }

  if (st.built.length === 0) throw new ModelParseError('E_MODEL_EMPTY', '3MF contains no renderable geometry');

  const bounds: ModelBounds = { min: st.min, max: st.max };
  return {
    objects: st.built,
    bounds,
    capabilities: {
      materials: st.anyColor ? 'known' : 'unavailable',
      transforms: st.anyTransform ? 'known' : 'unavailable',
      multiObject: st.built.length > 1 ? 'known' : 'unavailable'
    }
  };
}
