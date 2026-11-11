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
import { PerspectiveCamera, Scene } from 'three';
import {
  createDefaultGLRenderer,
  framingFromCenterRadius,
  type Backdrop,
  type BuildVolumeDef,
  type GLRendererLike,
  type RenderTargetCanvas,
  type Theme
} from '@chestnutlabs/gcode-renderer-three';
import { ModelContent, NEUTRAL_MATERIAL_COLOR } from './model-content.js';
import { ModelPlate, applyModelBackground, isTransparentBackground } from './model-plate.js';
import type { PlacementResult } from './placement.js';
import type { ModelScene, RenderScope } from './scene-model.js';

/**
 * A perspective vertical lens must be a number in [10, 120] degrees (DD-032 §4.2). Checked locally so the
 * renderer package's public API does not grow; the same literal range as the other lens setters.
 */
export function checkModelFov(fov: number): void {
  if (!(fov >= 10 && fov <= 120)) throw new RangeError(`cameraFov must be in [10, 120] degrees (got ${String(fov)})`);
}

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
  /** Build plate under the model (DD-032 §4.3). Omit for no plate (today's render). */
  buildVolume?: BuildVolumeDef | null;
  /** Plate/backdrop theme subset (DD-032 §4.3); `theme.background` beats `background`. Lights are not themed. */
  theme?: Theme;
  /** Vertical lens in degrees, [10, 120] (default 50). Framing is lens-aware. */
  cameraFov?: number;
}

export class ModelRenderer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 100_000);
  private readonly gl: GLRendererLike;
  private readonly content: ModelContent;
  private readonly plate: ModelPlate;
  private backdrop: Backdrop | null = null;
  private width = 300;
  private height = 300;
  private disposed = false;

  constructor(opts: ModelRendererOptions) {
    const background = opts.background ?? 'transparent';
    const transparent = isTransparentBackground(opts.theme, background);
    if (opts.cameraFov !== undefined) {
      checkModelFov(opts.cameraFov);
      this.camera.fov = opts.cameraFov;
    }
    this.gl =
      opts.createRenderer?.(opts.canvas) ??
      createDefaultGLRenderer(opts.canvas, {
        alpha: transparent,
        preserveDrawingBuffer: opts.preserveDrawingBuffer ?? true
      });

    this.backdrop = applyModelBackground(this.scene, opts.theme, background, null);
    // Root + studio rig + mesh building live in the shared scene core (DD-021).
    this.content = new ModelContent(this.scene);
    this.plate = new ModelPlate(this.scene, opts.buildVolume ?? null, opts.theme);
  }

  /** The plate placement decided by the last {@link setScene} (`null` placement = no plate drawn). */
  get placement(): PlacementResult {
    return this.plate.getPlacement();
  }

  /**
   * Build meshes for the scene and frame the camera. Replaces any previously-set scene. `ctx` carries the
   * whole source and the scope that narrowed it to `scene`, which the plate placement needs.
   */
  setScene(scene: ModelScene, ctx?: { full: ModelScene; scope: RenderScope | null }): void {
    if (this.disposed) return;
    this.content.setScene(scene);
    this.plate.update(this.content, ctx?.full ?? scene, scene, ctx?.scope ?? null);
    const framing = this.content.framing;
    if (framing === null) return;
    const { target, position } = framingFromCenterRadius(framing.center, framing.radius, this.camera.fov);
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
    this.plate.dispose();
    this.backdrop?.dispose();
    this.backdrop = null;
    this.content.dispose();
    this.gl.dispose();
  }
}

/** Exposed for tests: the neutral default color used when a model declares no material. */
export { NEUTRAL_MATERIAL_COLOR };
