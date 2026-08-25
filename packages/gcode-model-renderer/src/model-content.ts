/**
 * `ModelContent` (DD-021 Phase 1) — the shared presentation **scene core**: given a three.js `Scene`,
 * it adds the model root (Z-up→Y-up) and the studio light rig, then builds capability-honest meshes for
 * a {@link ModelScene} (incl. per-triangle `paint_color` vertex colours) and reports the model's framing
 * (center + radius) for the camera.
 *
 * It owns **no** GL renderer, camera, or controls — only scene content — so both the headless still
 * (`ModelRenderer` → `renderModelStill`, DD-018) and the interactive viewer (`createModelViewer`,
 * DD-021) build meshes and lighting through **one** path instead of parallel copies. The still keeps its
 * own GL + camera; the viewer drives the shared `InteractiveStage`. Both hand this class a `Scene`.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3
} from 'three';
import type { ModelObject, ModelScene, RGB } from './scene-model.js';

/** Neutral default surface when the source declares no material (never a fabricated source color). */
const NEUTRAL_COLOR: RGB = [0.8, 0.8, 0.82];

/** The framing a {@link ModelScene} implies: scene-space center and a bounding radius (model coords). */
export interface ModelFraming {
  center: Vector3;
  radius: number;
}

/**
 * Adds the model root + studio rig to a provided `Scene` and builds meshes into it. The root carries the
 * same Z-up(model)→Y-up(scene) rotation as the toolpath renderer, so the shared framing helper places
 * the camera identically. Lights live in scene space (not under the rotated root) so the key stays
 * top-ish regardless of model orientation.
 */
export class ModelContent {
  private readonly root = new Group();
  private readonly disposables: { dispose(): void }[] = [];
  private framedModel: ModelFraming | null = null;

  constructor(private readonly scene: Scene) {
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);

    // Studio rig (presentation-specific): soft hemisphere fill + a key directional + a low fill.
    const hemi = new HemisphereLight(0xffffff, 0x9098a5, 2.0);
    this.scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1, 0.8);
    this.scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.5);
    fill.position.set(-0.7, 0.3, -0.5);
    this.scene.add(fill);
  }

  /** Build meshes for the scene and record its framing. Replaces (and disposes) any previous meshes. */
  setScene(scene: ModelScene): void {
    this.clearMeshes();
    for (const obj of scene.objects) this.root.add(this.buildMesh(obj));

    const [minX, minY, minZ] = scene.bounds.min;
    const [maxX, maxY, maxZ] = scene.bounds.max;
    const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const radius = Math.max(1e-3, center.distanceTo(new Vector3(minX, minY, minZ)));
    this.framedModel = { center, radius };
  }

  /** The framing of the last-set scene (`null` before the first {@link setScene}). */
  get framing(): ModelFraming | null {
    return this.framedModel;
  }

  private buildMesh(obj: ModelObject): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(obj.geometry.positions, 3));
    if (obj.geometry.indices !== undefined) g.setIndex(new BufferAttribute(obj.geometry.indices, 1));
    if (obj.geometry.normals !== undefined) g.setAttribute('normal', new BufferAttribute(obj.geometry.normals, 3));
    else g.computeVertexNormals();

    const mat = new MeshStandardMaterial({ roughness: 0.62, metalness: 0.0 });
    if (obj.geometry.colors !== undefined) {
      // A single mesh carrying multiple colors (per-triangle 3MF material) → vertex colors.
      g.setAttribute('color', new BufferAttribute(obj.geometry.colors, 3));
      mat.vertexColors = true;
    } else {
      const color = obj.material?.color ?? NEUTRAL_COLOR;
      mat.color.setRGB(color[0], color[1], color[2]);
    }

    const mesh = new Mesh(g, mat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.fromArray(obj.transform as number[]);
    this.disposables.push(g, mat);
    return mesh;
  }

  private clearMeshes(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.root.clear();
  }

  /** Dispose all built geometries/materials (leaves the lights; the owner disposes the `Scene`). */
  dispose(): void {
    this.clearMeshes();
  }
}

/** Exposed for tests: the neutral default color used when a model declares no material. */
export const NEUTRAL_MATERIAL_COLOR: RGB = NEUTRAL_COLOR;
