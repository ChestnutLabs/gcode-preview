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
  filamentColoursFromSettings,
  DEFAULT_CONTAINER_LIMITS,
  type ZipDirectory
} from '@chestnutlabs/gcode-containers';
import {
  IDENTITY_MAT4,
  type Mat4,
  type MeshGeometry,
  type ModelBounds,
  type ModelObject,
  type ModelPlateSummary,
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
  triPaint: (string | null)[]; // per-triangle Bambu/Orca `paint_color` facet-paint hex, or null (#189 follow-up)
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

/**
 * Decode a Bambu/Orca `paint_color` facet-paint attribute (clean-room from the observed format —
 * see RR-005, NOT from Orca/PrusaSlicer GPL source). The value is a **little-endian** stream of 4-bit
 * nibble tokens forming a recursive triangle-split tree:
 *
 * - `token & 0b11` = split-sides: `0` ⇒ a **leaf**, otherwise the triangle is split into
 *   `split_sides + 1` children (2/3/4) that follow, decoded depth-first (`token >> 2` is the split
 *   side — irrelevant to a presentation render).
 * - a leaf's state is `token >> 2`, with `3` escaping into the following nibble (`3 + next`).
 *
 * **State 0 = the object's default extruder (unpainted); state s ≥ 1 = filament index s − 1.**
 * Returns the dominant leaf state plus whether the facet was subdivided (so the caller can flatten it
 * to one colour and disclose `approximated`), or `null` if the value is malformed/truncated.
 */
function decodePaintState(hex: string): { state: number; subdivided: boolean } | null {
  const clean = hex.trim();
  if (clean.length === 0) return null;
  const nibbles: number[] = [];
  for (let i = clean.length - 1; i >= 0; i--) {
    const n = parseInt(clean[i], 16);
    if (Number.isNaN(n)) return null;
    nibbles.push(n);
  }
  let pos = 0;
  const states: number[] = [];
  const next = (): number => {
    if (pos >= nibbles.length) throw new ModelParseError('E_MODEL_PARSE', 'paint_color underflow');
    return nibbles[pos++];
  };
  const node = (depth: number): void => {
    if (depth > 16) throw new ModelParseError('E_MODEL_PARSE', 'paint_color too deep');
    const t = next();
    const ss = t & 0b11;
    if (ss === 0) {
      const s2 = t >> 2;
      states.push(s2 === 3 ? 3 + next() : s2);
    } else {
      for (let i = 0; i <= ss; i++) node(depth + 1);
    }
  };
  try {
    node(0);
  } catch {
    return null;
  }
  if (states.length === 0) return null;
  // Dominant leaf state — subdivided facets are a tiny fraction of any real model, so flattening them
  // to their most-common state (and reporting `approximated`) is a faithful presentation trade-off.
  const counts = new Map<number, number>();
  let best = states[0];
  let bestN = 0;
  for (const s of states) {
    const c = (counts.get(s) ?? 0) + 1;
    counts.set(s, c);
    if (c > bestN) {
      bestN = c;
      best = s;
    }
  }
  return { state: best, subdivided: states.length > 1 };
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

/** The identity 3MF row-vector affine (12 values). */
const IDENTITY_AFFINE: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/**
 * Compose two 3MF affines so the result applies `inner` first, then `outer`:
 * `compose(outer, inner)(p) = outer(inner(p))`. Used to fold a component transform into the running
 * placement matrix while descending the assembly tree, without baking vertices (DD-022 instancing).
 */
function composeAffine(outer: number[], inner: number[]): number[] {
  const lin = (x: number, y: number, z: number): [number, number, number] => [
    outer[0] * x + outer[3] * y + outer[6] * z,
    outer[1] * x + outer[4] * y + outer[7] * z,
    outer[2] * x + outer[5] * y + outer[8] * z
  ];
  const c0 = lin(inner[0], inner[1], inner[2]);
  const c1 = lin(inner[3], inner[4], inner[5]);
  const c2 = lin(inner[6], inner[7], inner[8]);
  const t = lin(inner[9], inner[10], inner[11]);
  return [
    c0[0],
    c0[1],
    c0[2],
    c1[0],
    c1[1],
    c1[2],
    c2[0],
    c2[1],
    c2[2],
    t[0] + outer[9],
    t[1] + outer[10],
    t[2] + outer[11]
  ];
}

/** A 3MF row-vector affine (12 values), or null = identity, → a column-major {@link Mat4} (three layout). */
function affineToMat4(v: number[] | null): Mat4 {
  if (v === null) return IDENTITY_MAT4;
  return [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1];
}

/** Expand `st.min`/`st.max` by a local AABB [min,max] transformed by `affine` (its 8 corners). */
function expandBoundsByBox(
  st: { min: [number, number, number]; max: [number, number, number] },
  bmin: readonly [number, number, number],
  bmax: readonly [number, number, number],
  affine: number[]
): void {
  for (let c = 0; c < 8; c++) {
    const x = (c & 1) === 0 ? bmin[0] : bmax[0];
    const y = (c & 2) === 0 ? bmin[1] : bmax[1];
    const z = (c & 4) === 0 ? bmin[2] : bmax[2];
    const [wx, wy, wz] = applyTransform(affine, x, y, z);
    if (wx < st.min[0]) st.min[0] = wx;
    if (wy < st.min[1]) st.min[1] = wy;
    if (wz < st.min[2]) st.min[2] = wz;
    if (wx > st.max[0]) st.max[0] = wx;
    if (wy > st.max[1]) st.max[1] = wy;
    if (wz > st.max[2]) st.max[2] = wz;
  }
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
        curObj = {
          vertices: [],
          tris: [],
          triColorIdx: [],
          triPid: [],
          triPaint: [],
          components: [],
          name: a.name
        };
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
      curObj.triPaint.push(a.paint_color ?? null);
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

/** One unique master mesh + the placements (instance matrices) that reference it (DD-022). */
interface MasterRecord {
  object: ModelObject;
  instances: Mat4[];
  /** Plate id of each placement (DD-025), aligned with {@link instances}; empty when no plates declared. */
  plates: number[];
  localMin: [number, number, number];
  localMax: [number, number, number];
}

/** Accumulators threaded through the recursive resolve. */
interface BuildState {
  built: ModelObject[];
  /** Unique masters by `${partKey}#${objectid}` — a repeated placement adds an instance, not a copy. */
  masters: Map<string, MasterRecord>;
  anyColor: boolean;
  anyTransform: boolean;
  /** Whether any colour came from flattening a subdivided `paint_color` facet (→ `approximated`). */
  anyApprox: boolean;
  /** Scene filament palette (linear RGB by 0-based slot) from `project_settings.config`, or empty. */
  paintPalette: RGB[];
  /** 0-based default-extruder filament index applied to unpainted facets of a painted mesh. */
  defaultExtruderIdx: number;
  min: [number, number, number];
  max: [number, number, number];
  /** Unique triangles (each master counted once), NOT multiplied by instance count. */
  totalTris: number;
  /** Total placements across all masters. */
  totalInstances: number;
  /** Declared plate structure (DD-025), or `null` when the source declares none. */
  plateConfig: PlateConfig | null;
  /** Per-object/part 1-based extruder assignments (Bambu/Orca colour convention), keyed by id. */
  objectExtruders: Map<string, number>;
  /** Plate id of the placement currently being resolved (DD-025); inherited by every `placeMaster` in it. */
  currentPlateId: number | undefined;
  /** Per-plate accumulators (DD-025), keyed by plater_id. */
  plateBounds: Map<number, { min: [number, number, number]; max: [number, number, number] }>;
  plateInstanceCount: Map<number, number>;
  plateObjects: Map<number, Set<string>>;
}

/**
 * Record a placement's plate membership (DD-025): bump the plate's instance count, note the master it
 * references (distinct-object count), and expand the plate's bounds by this placement's transformed AABB.
 * A no-op when no plate is active (source declares no plates).
 */
function recordPlacementPlate(
  st: BuildState,
  masterKey: string,
  localMin: readonly [number, number, number],
  localMax: readonly [number, number, number],
  affine: number[]
): void {
  const p = st.currentPlateId;
  if (p === undefined) return;
  st.plateInstanceCount.set(p, (st.plateInstanceCount.get(p) ?? 0) + 1);
  let objs = st.plateObjects.get(p);
  if (objs === undefined) {
    objs = new Set();
    st.plateObjects.set(p, objs);
  }
  objs.add(masterKey);
  let b = st.plateBounds.get(p);
  if (b === undefined) {
    b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    st.plateBounds.set(p, b);
  }
  expandBoundsByBox(b, localMin, localMax, affine);
}

/**
 * Place one mesh object (DD-022 instancing). The FIRST time a master `${partKey}#${objectid}` is reached
 * its geometry is built once in LOCAL space (unit-scaled, un-baked); every reach — first and repeats —
 * records the placement `matrix` as an instance and expands the scene bounds by the master's local AABB
 * transformed by that matrix. So memory + the triangle budget scale with unique geometry, not copy count.
 */
function placeMaster(
  obj: ParsedObject,
  part: ModelPart,
  matrix: number[] | null,
  key: string,
  st: BuildState,
  lim: ResolvedLimits
): void {
  const affine = matrix ?? IDENTITY_AFFINE;
  const mat4 = affineToMat4(matrix);

  const existing = st.masters.get(key);
  if (existing !== undefined) {
    existing.instances.push(mat4);
    if (st.currentPlateId !== undefined) existing.plates.push(st.currentPlateId);
    st.totalInstances++;
    expandBoundsByBox(st, existing.localMin, existing.localMax, affine);
    recordPlacementPlate(st, key, existing.localMin, existing.localMax, affine);
    return;
  }

  const triCount = obj.tris.length / 3;
  st.totalTris += triCount;
  if (st.totalTris > lim.maxTriangles) {
    throw new ModelParseError('E_MODEL_TOO_MANY_TRIANGLES', `3MF exceeds triangle limit ${lim.maxTriangles}`);
  }
  const positions = new Float32Array(triCount * 9);
  let colors: Float32Array | null = null;
  let objHasColor = false;
  const localMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const localMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  // A mesh painted with Bambu/Orca `paint_color` (only meaningful when we have a filament palette).
  const objHasPaint = st.paintPalette.length > 0 && obj.triPaint.some((p) => p !== null);
  for (let ti = 0; ti < triCount; ti++) {
    // Paint path: one filament colour for the whole triangle. Painted facets decode to a state; the
    // unpainted facets of a painted mesh take the object's default-extruder colour (never left blank).
    let paintCol: RGB | undefined;
    if (objHasPaint) {
      let idx = st.defaultExtruderIdx;
      const paint = obj.triPaint[ti];
      if (paint !== null) {
        const dec = decodePaintState(paint);
        if (dec !== null) {
          idx = dec.state === 0 ? st.defaultExtruderIdx : dec.state - 1;
          if (dec.subdivided) st.anyApprox = true;
        }
      }
      paintCol = st.paintPalette[idx] ?? st.paintPalette[st.defaultExtruderIdx];
    }
    // Standard 3MF material path (basematerials / colorgroup + pid) — fallback when there's no paint.
    const pid = obj.triPid[ti];
    const palette = pid !== null ? part.palettes.get(pid) : undefined;
    const cidx = obj.triColorIdx[ti];
    for (let k = 0; k < 3; k++) {
      const vi = obj.tris[ti * 3 + k] * 3;
      // LOCAL geometry: unit scale only — the placement matrix (an instance transform) does the rest.
      const x = obj.vertices[vi] * part.unitScale;
      const y = obj.vertices[vi + 1] * part.unitScale;
      const z = obj.vertices[vi + 2] * part.unitScale;
      const o = (ti * 3 + k) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
      if (x < localMin[0]) localMin[0] = x;
      if (y < localMin[1]) localMin[1] = y;
      if (z < localMin[2]) localMin[2] = z;
      if (x > localMax[0]) localMax[0] = x;
      if (y > localMax[1]) localMax[1] = y;
      if (z > localMax[2]) localMax[2] = z;
      const col = paintCol ?? (palette !== undefined && cidx !== null ? (palette[cidx[k]] ?? palette[0]) : undefined);
      if (col !== undefined) {
        if (colors === null) colors = new Float32Array(triCount * 9);
        colors[o] = col[0];
        colors[o + 1] = col[1];
        colors[o + 2] = col[2];
        objHasColor = true;
      }
    }
  }
  if (objHasColor) st.anyColor = true;
  const geometry: MeshGeometry = colors !== null ? { positions, colors } : { positions };
  const object: ModelObject = { id: key, geometry, transform: mat4 };
  if (obj.name !== undefined) object.name = obj.name;
  // Bambu/Orca per-object/part extruder solid colour (maintainer-approved): when the object declares no
  // basematerials/colorgroup/paint colour, but the source assigns it an extruder and the project's
  // `filament_colour` palette has that slot, colour the whole object with `palette[extruder - 1]` (a solid
  // material colour). Honesty preserved: only when the source actually declares the mapping AND the palette
  // resolves — otherwise the object stays neutral (`materials: 'unavailable'`). Never guessed.
  if (!objHasColor && st.paintPalette.length > 0) {
    const oid = key.substring(key.lastIndexOf('#') + 1);
    const extruder = st.objectExtruders.get(oid);
    if (extruder !== undefined) {
      const col = st.paintPalette[extruder - 1];
      if (col !== undefined) {
        object.material = { color: col };
        st.anyColor = true;
      }
    }
  }
  st.masters.set(key, {
    object,
    instances: [mat4],
    plates: st.currentPlateId !== undefined ? [st.currentPlateId] : [],
    localMin,
    localMax
  });
  st.built.push(object);
  st.totalInstances++;
  expandBoundsByBox(st, localMin, localMax, affine);
  recordPlacementPlate(st, key, localMin, localMax, affine);
}

export interface Parse3mfOptions {
  /**
   * Override the source-model filament palette (hex `#RRGGBB` per 0-based slot) used to colour
   * `paint_color` facets, instead of reading it from `project_settings.config`. For consumers that
   * already hold a corrected/richer palette (e.g. re-rendering a sliced `.gcode.3mf`). Ignored when
   * empty; the file's own palette is still read.
   */
  filamentPalette?: readonly (string | undefined)[];
}

const hexPaletteToLinear = (hexes: readonly (string | undefined)[]): RGB[] =>
  hexes.map((hex) => (hex !== undefined ? (srgbHexToLinear(hex) ?? [0.8, 0.8, 0.82]) : [0.8, 0.8, 0.82]));

/** Declared plate structure parsed from `Metadata/model_settings.config` (Bambu/Orca) — DD-025. */
interface PlateConfig {
  /** `${object_id}#${instance_id}` → plater_id, mapping each declared model-instance to its plate. */
  membership: Map<string, number>;
  /** plater_id → declared plate name (only non-empty names). */
  names: Map<number, string>;
  /** Declared plater_ids in source order. */
  order: number[];
}

/**
 * Parse the `<plate>` elements of a Bambu/Orca `Metadata/model_settings.config` (DD-025). Each `<plate>`
 * carries a `plater_id` and a list of `<model_instance>` (`object_id` + `instance_id`) assigning the Nth
 * placement of a build-item object to that plate. Clean-room from the observed format (parity with the
 * RR-005 `paint_color` approach); tolerant scan — a malformed/absent config yields an empty result so the
 * scene honestly reports `capabilities.plates: 'unavailable'` rather than a fabricated split.
 *
 * Returns `null` when no `<plate>` is declared (⇒ implicit single plate, `'unavailable'`).
 */
export function parsePlateConfig(xml: string): PlateConfig | null {
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
    // Each <model_instance> declares object_id + instance_id (both required to key a placement).
    for (const inst of block.match(/<model_instance\b[\s\S]*?<\/model_instance>/gi) ?? []) {
      const objM = /key="object_id"\s+value="(\d+)"/i.exec(inst);
      const insM = /key="instance_id"\s+value="(\d+)"/i.exec(inst);
      if (objM === null || insM === null) continue;
      membership.set(`${objM[1]}#${insM[1]}`, plateId);
    }
  }
  return order.length > 0 ? { membership, names, order } : null;
}

/**
 * Parse per-object / per-part extruder assignments from `Metadata/model_settings.config` (Bambu/Orca) — a
 * source-model colour convention where each object/part is solid-coloured by its assigned filament
 * (`<object id="X">…<metadata key="extruder" value="N"/>`, and the same on nested `<part id="Y">`),
 * 1-based into the `filament_colour` palette. Returns a map of id → 1-based extruder. Each object/part's own
 * extruder is the FIRST `key="extruder"` in the window from its header to the next object/part header (so a
 * part's extruder overrides its parent object's default). Empty map ⇒ no assignments declared.
 */
export function parseObjectExtruders(xml: string): Map<string, number> {
  const map = new Map<string, number>();
  const headerRe = /<(?:object|part)\s+id="(\d+)"[^>]*>([\s\S]*?)(?=<(?:object|part)\s+id="|<\/config>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(xml)) !== null) {
    const id = m[1];
    const ext = /key="extruder"\s+value="(\d+)"/i.exec(m[2]);
    if (ext !== null) {
      const n = parseInt(ext[1], 10);
      if (Number.isFinite(n) && n >= 1) map.set(id, n);
    }
  }
  return map;
}

/**
 * Conservative UPPER bound on the XML bytes a single 3MF triangle (plus its amortized share of a shared
 * vertex) occupies — used to turn an external part's uncompressed byte size into a LOWER bound on its
 * triangle count (DD-022 §5/§13). Deliberately generous so the estimate never *over*-counts triangles and
 * so never false-rejects a file that would actually fit; a file only fast-rejects when even this
 * under-count exceeds the budget. Borderline files fall through to the exact parse.
 */
const EST_MAX_BYTES_PER_TRIANGLE = 256;

/**
 * Safety margin on the byte estimate (DD-022 §13): only *fast*-reject when the estimate is comfortably
 * over the triangle budget, so a `.model` part padded with non-triangle bytes (comments/metadata) is not
 * false-rejected. A file estimated between 1× and this multiple of the budget falls through to the exact
 * per-triangle parse, which enforces the real limit. Genuinely oversize plates (many × a large master)
 * are far past this and still reject in sub-second time.
 */
const EST_REJECT_MARGIN = 2;

/**
 * Fast structural cost estimate (DD-022 Phase 0), run after the (tiny, for production-extension files)
 * main part is parsed but BEFORE any large external geometry part is decompressed. Walks the build-item /
 * component tree counting **placements** (all of them) and a lower-bound **unique**-triangle estimate:
 *   - a mesh master's triangles are counted **once per unique master** (already parsed), NOT per placement;
 *   - an external `p:path` part is estimated from its ZIP-directory uncompressed size / the conservative
 *     bytes-per-triangle bound, counted **once per unique path** (a safe under-count), treated as a leaf.
 * Because instancing renders each master once (DD-022 Phase 1), the triangle estimate must be UNIQUE — a
 * full-sheet plate of ~40 copies costs its ~1 master, not ~40× baked, so it is NOT rejected here. The
 * placement count still guards an instance bomb (`maxInstances`). Throws {@link ModelParseError} for a
 * clear instance-bomb / oversize file so it rejects in sub-second time instead of ~10 s of decompress-and-
 * bake; files near the budget fall through to the exact per-triangle parse.
 */
function estimateSceneCost(
  mainPart: ModelPart,
  entryByName: (nameLower: string) => ZipDirectory['entries'][number] | undefined,
  lim: ResolvedLimits
): void {
  let instanceCount = 0;
  let estTriangles = 0;
  // Unique masters already counted toward the triangle estimate (keyed by objectid / external path), so a
  // reused master is counted once — matching the instanced render, not the old per-placement bake.
  const countedMasters = new Set<string>();

  const checkInstances = (): void => {
    if (instanceCount > lim.maxInstances) {
      throw new ModelParseError(
        'E_MODEL_TOO_MANY_INSTANCES',
        `3MF declares more than ${lim.maxInstances} instance placements`
      );
    }
  };

  const visit = (part: ModelPart, objectid: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const obj = part.objects.get(objectid);
    if (obj === undefined) return;
    if (obj.tris.length > 0) {
      instanceCount++;
      const key = `local:${objectid}`;
      if (!countedMasters.has(key)) {
        countedMasters.add(key);
        estTriangles += obj.tris.length / 3;
      }
      checkInstances();
    }
    for (const comp of obj.components) {
      if (comp.path !== undefined) {
        // External production-extension part: estimate from its directory size WITHOUT decompressing it.
        const norm = comp.path.replace(/^\//, '').toLowerCase();
        const entry = entryByName(norm);
        if (entry !== undefined) {
          instanceCount++;
          if (!countedMasters.has(norm)) {
            countedMasters.add(norm);
            estTriangles += entry.uncompressedSize / EST_MAX_BYTES_PER_TRIANGLE;
          }
          checkInstances();
        }
      } else {
        visit(part, comp.objectid, depth + 1); // local sub-object (already-parsed geometry)
      }
    }
  };

  const roots =
    mainPart.items.length > 0
      ? mainPart.items
      : [...mainPart.objects.keys()].map((objectid) => ({ objectid, transform: null }));
  for (const inst of roots) visit(mainPart, inst.objectid, 0);

  if (instanceCount > lim.maxInstances) {
    throw new ModelParseError(
      'E_MODEL_TOO_MANY_INSTANCES',
      `3MF declares more than ${lim.maxInstances} instance placements`
    );
  }
  if (estTriangles > lim.maxTriangles * EST_REJECT_MARGIN) {
    throw new ModelParseError(
      'E_MODEL_TOO_MANY_TRIANGLES',
      `3MF's estimated ${Math.round(estTriangles)} triangles exceed the limit ${lim.maxTriangles}`
    );
  }
}

export async function parse3mf(
  source: Uint8Array | ArrayBuffer,
  limits?: ModelLimits,
  opts?: Parse3mfOptions
): Promise<ModelScene> {
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

  // Fast structural cost estimate (DD-022 Phase 0): reject a clear instance-bomb / oversize plate now,
  // from the main part's structure + the ZIP directory, BEFORE decompressing any large external geometry
  // part in `resolve` — sub-second instead of ~10 s of decompress-and-bake.
  estimateSceneCost(mainPart, entryByName, lim);

  // Source-model filament palette for Bambu/Orca `paint_color`: it lives in `project_settings.config`
  // (`filament_colour`), NOT the model XML, so the render is self-contained and needs no slicer output.
  let paintPalette: RGB[] = [];
  const override = opts?.filamentPalette;
  if (override !== undefined && override.length > 0) {
    // Consumer-supplied palette wins over the file's own (e.g. a corrected slicer palette).
    paintPalette = hexPaletteToLinear(override);
  } else {
    const settingsEntry = entryByName('metadata/project_settings.config');
    if (settingsEntry !== undefined) {
      try {
        const json = new TextDecoder().decode(await extractEntry(bytes, settingsEntry, climits.maxMetadataBytes));
        const settings = JSON.parse(json) as Record<string, unknown>;
        paintPalette = hexPaletteToLinear(filamentColoursFromSettings(settings));
      } catch {
        // Malformed/oversized settings → no palette; paint stays capability-honest `unavailable`.
        paintPalette = [];
      }
    }
  }
  // `model_settings.config` (Bambu/Orca) carries both the default extruder for unpainted facets AND the
  // declared plate structure (DD-025) — read once.
  let defaultExtruderIdx = 0;
  let plateConfig: PlateConfig | null = null;
  let objectExtruders = new Map<string, number>();
  const modelSettingsEntry = entryByName('metadata/model_settings.config');
  if (modelSettingsEntry !== undefined) {
    try {
      const xml = new TextDecoder().decode(await extractEntry(bytes, modelSettingsEntry, climits.maxMetadataBytes));
      const m = /key="extruder"\s+value="(\d+)"/i.exec(xml);
      const n = m !== null ? parseInt(m[1], 10) : NaN;
      if (Number.isFinite(n) && n >= 1) defaultExtruderIdx = n - 1;
      plateConfig = parsePlateConfig(xml);
      objectExtruders = parseObjectExtruders(xml);
    } catch {
      defaultExtruderIdx = 0;
      plateConfig = null;
      objectExtruders = new Map();
    }
  }

  const st: BuildState = {
    built: [],
    masters: new Map(),
    anyColor: false,
    anyTransform: false,
    anyApprox: false,
    paintPalette,
    defaultExtruderIdx,
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    totalTris: 0,
    totalInstances: 0,
    plateConfig,
    objectExtruders,
    currentPlateId: undefined,
    plateBounds: new Map(),
    plateInstanceCount: new Map(),
    plateObjects: new Map()
  };

  // Resolve an object (mesh and/or components) within `part`, folding component transforms into the
  // running placement `matrix` (DD-022) instead of baking vertices. `partKey` identifies the part so the
  // same `${partKey}#${objectid}` master, reached via different placements, is instanced not copied.
  const resolve = async (
    part: ModelPart,
    objectid: string,
    matrix: number[] | null,
    partKey: string,
    depth: number
  ): Promise<void> => {
    if (depth > MAX_DEPTH) return;
    const obj = part.objects.get(objectid);
    if (obj === undefined) return;
    if (obj.tris.length > 0) placeMaster(obj, part, matrix, `${partKey}#${objectid}`, st, lim);
    for (const comp of obj.components) {
      const targetPart = comp.path !== undefined ? await getPartByPath(comp.path) : part;
      if (targetPart === null) continue;
      // Fold the component transform (child → this object) into the placement, then descend.
      const childMatrix = comp.transform !== null ? composeAffine(matrix ?? IDENTITY_AFFINE, comp.transform) : matrix;
      if (comp.transform !== null) st.anyTransform = true;
      const childKey = comp.path !== undefined ? comp.path.replace(/^\//, '').toLowerCase() : partKey;
      await resolve(targetPart, comp.objectid, childMatrix, childKey, depth + 1);
    }
  };

  // With no <build>, resolve every declared object at identity (some minimal 3MFs omit build).
  const mainKey = mainEntry.name.toLowerCase();
  const roots =
    mainPart.items.length > 0
      ? mainPart.items
      : [...mainPart.objects.keys()].map((objectid) => ({ objectid, transform: null }));
  // Per-object-id ordinal so the Nth build item of object X maps to plate `X#N` (DD-025).
  const rootOrdinals = new Map<string, number>();
  for (const inst of roots) {
    if (inst.transform !== null) st.anyTransform = true;
    if (st.plateConfig !== null) {
      const ord = rootOrdinals.get(inst.objectid) ?? 0;
      rootOrdinals.set(inst.objectid, ord + 1);
      // Unmapped placement (declared plates but this one not listed) → the first declared plate, so
      // plateIds stay complete and aligned; never fabricated silently beyond that fallback.
      st.currentPlateId = st.plateConfig.membership.get(`${inst.objectid}#${ord}`) ?? st.plateConfig.order[0];
    }
    await resolve(mainPart, inst.objectid, inst.transform, mainKey, 0);
  }

  if (st.built.length === 0) throw new ModelParseError('E_MODEL_EMPTY', '3MF contains no renderable geometry');

  // Attach the instance list to any master reached more than once (a single placement keeps its
  // `transform` and omits `instances`, per the contract). Plate ids (DD-025) attach per placement,
  // aligned with `instances` when present, else the single placement.
  for (const rec of st.masters.values()) {
    if (rec.instances.length > 1) rec.object.instances = rec.instances;
    if (rec.plates.length > 0) rec.object.plateIds = rec.plates;
  }

  const bounds: ModelBounds = { min: st.min, max: st.max };
  const scene: ModelScene = {
    objects: st.built,
    bounds,
    capabilities: {
      // `approximated` when any colour came from flattening a subdivided `paint_color` facet.
      materials: st.anyApprox ? 'approximated' : st.anyColor ? 'known' : 'unavailable',
      transforms: st.anyTransform ? 'known' : 'unavailable',
      multiObject: st.built.length > 1 ? 'known' : 'unavailable',
      // Instancing preserved when there are more placements than unique masters.
      instanced: st.totalInstances > st.masters.size ? 'known' : 'unavailable',
      // Plate structure is `known` only when the source explicitly declared plates (DD-025).
      plates: st.plateConfig !== null ? 'known' : 'unavailable'
    }
  };

  const pc = st.plateConfig;
  if (pc !== null) {
    const list: ModelPlateSummary[] = pc.order.map((id) => {
      const b = st.plateBounds.get(id);
      const summary: ModelPlateSummary = {
        id,
        objectCount: st.plateObjects.get(id)?.size ?? 0,
        instanceCount: st.plateInstanceCount.get(id) ?? 0,
        bounds: b !== undefined ? { min: b.min, max: b.max } : { min: [0, 0, 0], max: [0, 0, 0] }
      };
      const name = pc.names.get(id);
      if (name !== undefined) summary.name = name;
      return summary;
    });
    scene.plates = { list };
  }

  return scene;
}
