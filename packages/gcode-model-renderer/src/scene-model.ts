/**
 * The three-free presentation scene model (DD-018 §4.1).
 *
 * `ModelScene` is what `ModelRenderer` renders: one or more positioned objects with optional
 * per-object material/color. It is **multi-object and material-capable from day one** — STL is the
 * degenerate single-object, no-material case; 3MF (Phase 2) is the general multi-object/material case.
 * Keeping the public shape general now means the STL slice cannot lock in a model that 3MF must replace.
 *
 * The types are deliberately three-free (plain numbers / typed arrays) so the package's public surface
 * never leaks `three`; `ModelRenderer` builds three meshes/materials from a `ModelScene` internally.
 */
import type { Confidence } from '@chestnutlabs/toolpath-core';

/** Linear RGB in 0..1. */
export type RGB = [number, number, number];

/** A 4×4 column-major transform (three's `Matrix4.elements` layout). Identity for a bare STL. */
export type Mat4 = readonly number[];

/** Axis-aligned bounds in scene units (mm assumed unless the source declares otherwise). */
export interface ModelBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** Triangle mesh geometry (three-free). Positions are required; normals/indices/colors are optional. */
export interface MeshGeometry {
  /** Flat XYZ positions, length = 3·vertexCount. */
  positions: Float32Array;
  /** Optional flat XYZ normals (same length as positions); recomputed if absent. */
  normals?: Float32Array;
  /** Optional triangle indices; non-indexed (soup) when absent. */
  indices?: Uint32Array;
  /**
   * Optional flat per-vertex **linear** RGB colors (length = positions.length), for a single mesh that
   * carries multiple colors (per-triangle material assignment in 3MF). When present the renderer uses
   * vertex colors; when absent the object's {@link ModelObject.material} (or the neutral default) applies.
   */
  colors?: Float32Array;
}

/** A source material for an object — solid color only in v1 (textures deferred, DD-018 §13). */
export interface ModelMaterial {
  /** Base color when the source declared one; omit for "no declared material". */
  color?: RGB;
}

/** One positioned object in a scene. */
export interface ModelObject {
  /** Stable within a scene (3MF object id; `'stl'` for a bare STL). */
  id: string;
  /** Source-declared object name when present. */
  name?: string;
  /**
   * Geometry in the object's own local space when {@link instances} is present (the placements position
   * it); otherwise positioned by {@link transform}. A bare STL / single-placement object leaves it as the
   * source geometry.
   */
  geometry: MeshGeometry;
  /** Object→scene transform (identity for STL). For an instanced master, equals `instances[0]`. */
  transform: Mat4;
  /**
   * All scene-space placements of this master mesh — production-extension components / repeated build
   * items that reuse the same geometry (DD-022). Present only when the source reused the mesh (length ≥ 2);
   * absent ⇒ a single placement at {@link transform}. A renderer draws one geometry upload across these
   * transforms (GPU instancing), so memory scales with unique geometry, not copy count.
   */
  instances?: Mat4[];
  /**
   * Per-**placement** plate membership (DD-025): `plateIds[i]` is the {@link ModelPlateSummary.id} (plater
   * id) of placement `i` — aligned with {@link instances} when present, else index 0 is the single placement at
   * {@link transform}. Plate membership lives on the placement, not the master, because the same reused
   * master can be instantiated on more than one plate. Absent ⇒ the source declared no plate structure
   * (`capabilities.plates: 'unavailable'`), never fabricated.
   */
  plateIds?: number[];
  /** Omitted ⇒ no source material ⇒ neutral default render + `capabilities.materials: 'unavailable'`. */
  material?: ModelMaterial;
}

/**
 * One declared plate in a multi-plate source (DD-025), paralleling the toolpath-side `PlateSummary`.
 * Present only when the source **explicitly** declares plate structure (Bambu/Orca
 * `Metadata/model_settings.config`); an undeclared/implicit single plate is not summarized here.
 */
export interface ModelPlateSummary {
  /** The source's plater id (`plater_id`), stable within the scene. */
  id: number;
  /** Source-declared plate name when present and non-empty. */
  name?: string;
  /** Distinct master objects referenced by this plate's placements (a master shared across plates counts in each). */
  objectCount: number;
  /** Placements assigned to this plate. */
  instanceCount: number;
  /** Axis-aligned bounds of this plate's placements, in scene units. */
  bounds: ModelBounds;
}

/** A presentation scene: one or more objects plus capability honesty about what the source carried. */
export interface ModelScene {
  objects: ModelObject[];
  bounds: ModelBounds;
  /**
   * Declared plate structure (DD-025). Present only when the source **explicitly** declares plates; a
   * consumer shows a plate selector only when `capabilities.plates === 'known'`. `active` is the source's
   * active/default plate id when declared (a consumer's natural initial selection — the renderer never
   * forces all-plates).
   */
  plates?: { list: ModelPlateSummary[]; active?: number };
  /** What the source actually carried (DD-001 ethos — never fabricated). */
  capabilities: {
    /** `'known'` when the source assigned colors/materials, else `'unavailable'`. */
    materials: Confidence;
    /** `'known'` for real per-object transforms (3MF); `'unavailable'` for a bare STL. */
    transforms: Confidence;
    /** `'known'` when the source declared more than one object. */
    multiObject: Confidence;
    /** `'known'` when the source reused geometry via instances (more placements than unique masters), so
     *  the scene preserved it as GPU instancing (DD-022); `'unavailable'` otherwise. */
    instanced: Confidence;
    /** `'known'` when the source **explicitly** declares plate structure (incl. an explicit single plate);
     *  `'unavailable'` for undeclared/implicit plate structure (DD-025). */
    plates: Confidence;
  };
}

/**
 * A render-scope selector (DD-030 D2): which objects/placements of a scene to render. Generic and
 * vendor-neutral — a plate is one way to derive the subset. `{plateId}` is sugar over the placement's
 * {@link ModelObject.plateIds} (meaningful only when `capabilities.plates === 'known'`; on a scene with
 * no plate structure it matches nothing → an empty scene, the honest result of selecting a plate that
 * isn't declared). `{objectIds}` and `{instanceFilter}` need no capability (ids are always known).
 */
export type RenderScope =
  | { objectIds: string[] }
  | { plateId: number }
  | { instanceFilter: (objectId: string, placementIndex: number) => boolean };

/** Local axis-aligned bounds of a geometry's positions. */
function geometryAABB(positions: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/** Transform a point by a column-major (three `Matrix4.elements`) affine Mat4. */
function applyMat4(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

/** Union of the world AABBs of the given placements of an object's geometry, into `acc`. */
function accumulatePlacementBounds(geom: MeshGeometry, placements: readonly Mat4[], acc: ModelBounds): void {
  const { min: lmin, max: lmax } = geometryAABB(geom.positions);
  if (lmin[0] > lmax[0]) return; // empty geometry
  const mut = acc as { min: [number, number, number]; max: [number, number, number] };
  for (const m of placements) {
    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cz = 0; cz < 2; cz++) {
          const w = applyMat4(m, cx ? lmax[0] : lmin[0], cy ? lmax[1] : lmin[1], cz ? lmax[2] : lmin[2]);
          for (let a = 0; a < 3; a++) {
            if (w[a] < mut.min[a]) mut.min[a] = w[a];
            if (w[a] > mut.max[a]) mut.max[a] = w[a];
          }
        }
      }
    }
  }
}

/**
 * Return a filtered copy of `scene` containing only the objects/placements the scope selects, with
 * `bounds` recomputed from the kept placements (so a consumer frames just the selected plate/subset).
 * Pure and three-free. Objects with no kept placement are dropped; an empty result (nothing matched) is
 * a valid, honest scene — a `{plateId}` that matches nothing renders empty by design (gate on
 * `capabilities.plates === 'known'`). `scene.plates`/`capabilities` are preserved (the source's declared
 * structure is unchanged; only what is *rendered* is narrowed).
 */
export function applyRenderScope(scene: ModelScene, scope: RenderScope): ModelScene {
  const matches = (o: ModelObject, i: number): boolean => {
    if ('objectIds' in scope) return scope.objectIds.includes(o.id);
    if ('plateId' in scope) return o.plateIds?.[i] === scope.plateId;
    return scope.instanceFilter(o.id, i);
  };
  const objects: ModelObject[] = [];
  const bounds: ModelBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const o of scene.objects) {
    const placements: readonly Mat4[] = o.instances ?? [o.transform];
    const kept: number[] = [];
    for (let i = 0; i < placements.length; i++) if (matches(o, i)) kept.push(i);
    if (kept.length === 0) continue;
    const keptPlacements = kept.map((i) => placements[i]);
    const next: ModelObject = {
      ...o,
      transform: keptPlacements[0],
      instances: keptPlacements.length > 1 ? keptPlacements.slice() : undefined,
      plateIds: o.plateIds ? kept.map((i) => o.plateIds![i]) : undefined
    };
    objects.push(next);
    accumulatePlacementBounds(o.geometry, keptPlacements, bounds);
  }
  const finalBounds: ModelBounds = objects.length === 0 ? { min: [0, 0, 0], max: [0, 0, 0] } : bounds;
  return { ...scene, objects, bounds: finalBounds };
}

/** The identity transform (column-major), for single-object sources. */
export const IDENTITY_MAT4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Total placements drawn across a scene (DD-022): the sum of each object's instance count (a reused
 * master counts its `instances`, a single-placement object counts 1). Reported on `ready` / the still
 * result so a consumer can badge "N copies".
 */
export function sceneInstanceCount(scene: ModelScene): number {
  let n = 0;
  for (const o of scene.objects) n += o.instances?.length ?? 1;
  return n;
}
