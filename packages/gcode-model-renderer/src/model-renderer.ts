/**
 * `ModelRenderer` (DD-018 §4.2) — a presentation render of a {@link ModelScene}, on the shared render
 * "stage" from `@chestnutlabs/gcode-renderer-three` (framing pose, GL builder, GL type contracts).
 *
 * Distinct from the toolpath renderer: no tubes/travel/layers — just the model, framed at a fixed 3/4
 * angle under neutral studio lighting, on a transparent or themed background. Its lighting is its own
 * (DD-018 §4.3): a presentation studio rig, not the toolpath light rig.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3
} from 'three';
import {
  createDefaultGLRenderer,
  framingFromCenterRadius,
  type GLRendererLike,
  type RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import type { ModelObject, ModelScene, RGB } from './scene-model.js';

/** Background: `'transparent'` (composite on a card) or a solid CSS color / 0xRRGGBB. */
export type ModelBackground = 'transparent' | string | number;

/** Preset presentation angle. v1 implements `'iso'` (the shared 3/4 pose); others are reserved. */
export type PresentationView = 'iso';

/** Neutral default surface when the source declares no material (never a fabricated source color). */
const NEUTRAL_COLOR: RGB = [0.8, 0.8, 0.82];

export interface ModelRendererOptions {
  canvas: RenderTargetCanvas;
  background?: ModelBackground;
  /** Injected GL (tests / exotic hosts). Default: the shared stage builder, alpha on for transparency. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  preserveDrawingBuffer?: boolean;
}

export class ModelRenderer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 100_000);
  private readonly gl: GLRendererLike;
  private readonly root = new Group();
  private readonly disposables: { dispose(): void }[] = [];
  private width = 300;
  private height = 300;
  private disposed = false;

  constructor(opts: ModelRendererOptions) {
    const transparent = (opts.background ?? 'transparent') === 'transparent';
    this.gl =
      opts.createRenderer?.(opts.canvas) ??
      createDefaultGLRenderer(opts.canvas, {
        alpha: transparent,
        preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true
      });

    // Same Z-up(printer/model) → Y-up(scene) convention as the toolpath renderer, so the shared
    // framing helper places the camera identically.
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    this.scene.background = transparent ? null : new Color(opts.background as string | number);

    // Studio rig (presentation-specific): soft hemisphere fill + a key directional. Lights live in
    // scene space (not under the rotated root) so the key stays top-ish regardless of model orientation.
    const hemi = new HemisphereLight(0xffffff, 0x9098a5, 2.0);
    this.scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1, 0.8);
    this.scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.5);
    fill.position.set(-0.7, 0.3, -0.5);
    this.scene.add(fill);
  }

  /** Build meshes for the scene and frame the camera. Replaces any previously-set scene. */
  setScene(scene: ModelScene): void {
    if (this.disposed) return;
    this.clearMeshes();
    for (const obj of scene.objects) this.root.add(this.buildMesh(obj));

    // Frame from the model's own bounds (model/printer coords), via the shared stage pose.
    const [minX, minY, minZ] = scene.bounds.min;
    const [maxX, maxY, maxZ] = scene.bounds.max;
    const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    const radius = Math.max(1e-3, center.distanceTo(new Vector3(minX, minY, minZ)));
    const { target, position } = framingFromCenterRadius(center, radius);
    this.camera.position.copy(position);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.camera.aspect = height > 0 ? width / height : 1;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(width, height, false);
  }

  render(): void {
    if (this.disposed) return;
    this.gl.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearMeshes();
    this.gl.dispose();
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
}

/** Exposed for tests: the neutral default color used when a model declares no material. */
export const NEUTRAL_MATERIAL_COLOR: RGB = NEUTRAL_COLOR;
