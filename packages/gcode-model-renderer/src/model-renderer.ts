/**
 * `ModelRenderer` (DD-018 §4.2) — a presentation render of a {@link ModelScene}, on the shared render
 * "stage" from `@chestnutlabs/gcode-renderer-three` (framing pose, GL builder, GL type contracts).
 *
 * Distinct from the toolpath renderer: no tubes/travel/layers — just the model, framed at a fixed 3/4
 * angle under neutral studio lighting, on a transparent or themed background. Its scene content (root,
 * studio lights, capability-honest meshes) is built by the shared {@link ModelContent} core (DD-021),
 * so the still and the interactive viewer share one mesh/lighting/paint path; this class adds the
 * headless GL + camera + framing on top.
 */
import { Color, PerspectiveCamera, Scene } from 'three';
import {
  createDefaultGLRenderer,
  framingFromCenterRadius,
  type GLRendererLike,
  type RenderTargetCanvas
} from '@chestnutlabs/gcode-renderer-three';
import { ModelContent, NEUTRAL_MATERIAL_COLOR } from './model-content.js';
import type { ModelScene } from './scene-model.js';

/** Background: `'transparent'` (composite on a card) or a solid CSS color / 0xRRGGBB. */
export type ModelBackground = 'transparent' | string | number;

/** Preset presentation angle. v1 implements `'iso'` (the shared 3/4 pose); others are reserved. */
export type PresentationView = 'iso';

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
  private readonly content: ModelContent;
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

    this.scene.background = transparent ? null : new Color(opts.background as string | number);
    // Root + studio rig + mesh building live in the shared scene core (DD-021).
    this.content = new ModelContent(this.scene);
  }

  /** Build meshes for the scene and frame the camera. Replaces any previously-set scene. */
  setScene(scene: ModelScene): void {
    if (this.disposed) return;
    this.content.setScene(scene);
    const framing = this.content.framing;
    if (framing === null) return;
    const { target, position } = framingFromCenterRadius(framing.center, framing.radius);
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
    this.content.dispose();
    this.gl.dispose();
  }
}

/** Exposed for tests: the neutral default color used when a model declares no material. */
export { NEUTRAL_MATERIAL_COLOR };
