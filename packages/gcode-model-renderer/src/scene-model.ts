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
  /** Omitted ⇒ no source material ⇒ neutral default render + `capabilities.materials: 'unavailable'`. */
  material?: ModelMaterial;
}

/** A presentation scene: one or more objects plus capability honesty about what the source carried. */
export interface ModelScene {
  objects: ModelObject[];
  bounds: ModelBounds;
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
  };
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
