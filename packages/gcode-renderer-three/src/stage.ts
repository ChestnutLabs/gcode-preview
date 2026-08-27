/**
 * Shared render "stage" — the presentation primitives common to both the toolpath renderer
 * (`ToolpathRenderer`) and the forthcoming `ModelRenderer` (DD-018 Phase 0, #297).
 *
 * This module holds renderer-agnostic scene/camera/theme/offscreen machinery so the two renderers
 * single-source it and cannot drift. Per DD-018 §12 the stage lives inside `gcode-renderer-three`
 * short-term; a dedicated `render-stage` package is a later, non-blocking cleanup.
 *
 * It is grown incrementally and each move is gated by the toolpath renderer's existing golden/visual
 * parity (the extraction must be behavior-preserving for the toolpath side).
 */
import { Camera, Scene, Vector3, WebGLRenderer, type WebGLRenderTarget } from 'three';

/**
 * Render target: a DOM canvas (interactive hosts) or an OffscreenCanvas (workers / headless
 * still-render, #132). Both are EventTargets with WebGL2, so the stage treats them uniformly.
 */
export type RenderTargetCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Minimal surface of `WebGLRenderer` the stage/renderers use — injectable for tests. */
export interface GLRendererLike {
  // Base `Camera`, not `PerspectiveCamera`: the active camera may be either projection (#150).
  // Every stub GL ignores the arg, so this only widens types.
  render(scene: Scene, camera: Camera): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio?(ratio: number): void;
  dispose(): void;
  domElement: RenderTargetCanvas;
  // Render-target readback for interactive `capture()` (DD-030 D1). Optional: a real `WebGLRenderer`
  // provides both; a stub GL (tests / no WebGL) provides neither, so `capture()` reports unsupported.
  setRenderTarget?(target: WebGLRenderTarget | null): void;
  readRenderTargetPixels?(
    target: WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: Uint8Array
  ): void;
}

/** True when the renderer can render-to-target + read back — the requirement for `capture()`. */
export function supportsCapture(
  gl: GLRendererLike
): gl is GLRendererLike & Required<Pick<GLRendererLike, 'setRenderTarget' | 'readRenderTargetPixels'>> {
  return typeof gl.setRenderTarget === 'function' && typeof gl.readRenderTargetPixels === 'function';
}

/** Options for {@link createDefaultGLRenderer}. */
export interface DefaultGLOptions {
  /** Keep the drawing buffer readable after render (headless still-capture). Default false. */
  preserveDrawingBuffer?: boolean;
  /** Alpha channel in the drawing buffer → transparent background when the scene background is unset.
   *  ModelRenderer's card-thumbnail path sets this true; the toolpath renderer leaves it false. */
  alpha?: boolean;
  /** MSAA. Default true. */
  antialias?: boolean;
}

/**
 * The default `WebGLRenderer` the stage builds when a consumer injects none. Extracted from
 * `ToolpathRenderer`'s constructor (DD-018 Phase 0) so both renderers create GL identically; the
 * `alpha` option is the only addition (needed for ModelRenderer's transparent background).
 */
export function createDefaultGLRenderer(canvas: RenderTargetCanvas, opts: DefaultGLOptions = {}): WebGLRenderer {
  return new WebGLRenderer({
    canvas: canvas as HTMLCanvasElement,
    antialias: opts.antialias ?? true,
    preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    alpha: opts.alpha ?? false
  });
}

/** A framed camera pose (scene coordinates) derived from a model's center + bounding radius. */
export interface Framing {
  /** Orbit/look target in scene coords. */
  target: Vector3;
  /** Camera position in scene coords. */
  position: Vector3;
  /** Vertical half-height the camera frames at the target plane — sizes an orthographic frustum. */
  viewHalfHeight: number;
}

/**
 * Deterministic framing pose from a model **center** and bounding **radius** (both in printer
 * coordinates). Converts printer coords → scene coords through the root Z-up→Y-up rotation
 * (`x, z, -y`) and places the camera at the fixed 3/4 offset the renderers share.
 *
 * The perspective offset magnitude is ≈2.69·radius at fov 50°, so the visible half-height at the
 * target plane is ≈2.69·radius·tan(25°) ≈ 1.25·radius; an orthographic frustum uses the same
 * half-height so toggling projection keeps the model the same apparent size (#150).
 *
 * Extracted verbatim from `ToolpathRenderer.frame()` (DD-018 Phase 0) so `ModelRenderer` frames
 * identically. Pure — allocates and returns fresh vectors; mutates nothing.
 */
export function framingFromCenterRadius(center: Vector3, radius: number): Framing {
  const target = new Vector3(center.x, center.z, -center.y);
  const viewHalfHeight = radius * 1.25;
  const position = new Vector3(target.x - radius * 1.2, target.y + radius * 1.6, target.z + radius * 1.8);
  return { target, position, viewHalfHeight };
}
