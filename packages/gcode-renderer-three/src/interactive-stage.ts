/**
 * `InteractiveStage` (DD-021 Phase 0) — the shared interactive **viewport**: it owns the WebGL
 * renderer, the dual perspective/orthographic camera, the orbit/zoom/pan controls, WebGL context-loss
 * recovery, resize, the damage-driven render, and the DD-020 interaction-aware quality controller. It
 * renders a `Scene` the owner provides and fills — it holds no scene content, geometry, or IR of its
 * own — so both the toolpath renderer and the interactive model viewer (DD-021) drive one
 * implementation instead of parallel camera/controls stacks.
 *
 * The camera types live here (not in the toolpath renderer) so the stage has no dependency on
 * toolpath concepts; the toolpath renderer re-exports them for import-path stability.
 */
import { Color, OrthographicCamera, PerspectiveCamera, Scene, Vector3, WebGLRenderTarget } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec3 } from '@chestnutlabs/toolpath-core';
import {
  createDefaultGLRenderer,
  framingFromCenterRadius,
  supportsCapture,
  type GLRendererLike,
  type RenderTargetCanvas
} from './stage.js';
import {
  CaptureUnsupportedError,
  encodeRGBAToBlob,
  flipRowsRGBA,
  resolveCaptureSize,
  type CaptureOptions
} from './capture.js';
import { InteractionQualityController } from './interaction-quality.js';

/**
 * Camera projection (#150, DD-009 D3). `perspective` is the default interactive view; `orthographic`
 * gives parallel-projection technical/dimensional views. Switching preserves direction/target/framing.
 */
export type CameraMode = 'perspective' | 'orthographic';

/** Preset orientations for {@link InteractiveStage.setView} (#268). `iso` is the front-top-right corner. */
export type CameraView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

/**
 * A serializable snapshot of the camera (#268), in **scene coordinates** — a stable contract a
 * dashboard may persist across sessions. {@link InteractiveStage.getCameraState} reads it and
 * {@link InteractiveStage.setCameraState} restores it verbatim (no re-fit to the current model).
 */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  /** Camera zoom factor (three's `camera.zoom`); mainly meaningful for the orthographic view. */
  zoom: number;
  cameraMode: CameraMode;
}

/**
 * Unit direction (scene coords) from the framed target to the camera for each preset (#268). The root
 * rotation maps printer (x,y,z) → scene (x, z, -y), so e.g. printer +Z "up" is scene +Y.
 */
export const VIEW_DIRECTIONS: Record<CameraView, readonly [number, number, number]> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  iso: [1, 1, 1]
};

/** The subset of three's `OrbitControls` the stage drives — injectable for headless control-wiring tests. */
export interface ControlsLike {
  object: PerspectiveCamera | OrthographicCamera;
  target: Vector3;
  enabled: boolean;
  zoomToCursor?: boolean;
  minDistance?: number;
  maxDistance?: number;
  update(): void;
  dispose(): void;
  addEventListener(type: string, listener: () => void): void;
  listenToKeyEvents(element: HTMLElement): void;
}

export interface InteractiveStageOptions {
  canvas: RenderTargetCanvas;
  /** The scene the stage renders. The owner creates it, adds content/lights, and rebuilds it on restore. */
  scene: Scene;
  cameraMode?: CameraMode;
  /** DD-020 interaction-aware quality; default `'off'`. */
  interactionQuality?: 'off' | 'auto';
  /** Preserve the drawing buffer so the canvas is readable after a render (headless still). */
  preserveDrawingBuffer?: boolean;
  /** Injectable GL (tests / exotic hosts). Default: the shared stage builder. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  /** Injectable controls (tests). Default: three `OrbitControls`; skipped on a non-DOM canvas. */
  createControls?: (camera: PerspectiveCamera | OrthographicCamera, domElement: HTMLElement) => ControlsLike;
  /** Emitted once per gesture after the camera settles, with the new pose (#275/M6). */
  onCameraChanged?: (state: CameraState) => void;
  /** WebGL context lost — the owner should treat GPU resources as gone. */
  onContextLost?: () => void;
  /** WebGL context restored — the owner rebuilds its scene content here. */
  onContextRestored?: () => void;
}

/** True for a real DOM canvas (has DOM-only members OffscreenCanvas lacks). */
function isHtmlCanvas(c: RenderTargetCanvas): c is HTMLCanvasElement {
  return typeof (c as Partial<HTMLCanvasElement>).addEventListener === 'function' && 'style' in c;
}

export class InteractiveStage {
  readonly gl: GLRendererLike;
  readonly perspectiveCamera: PerspectiveCamera;
  readonly orthographicCamera: OrthographicCamera;
  private activeCameraRef: PerspectiveCamera | OrthographicCamera;
  private cameraModeState: CameraMode;
  private aspect = 1;
  /** Vertical half-height the camera frames; sizes the ortho frustum. */
  private viewHalfHeight = 100;
  /** Last framed orbit target (scene coords); mirrors `controls.target` and stands in for it headless. */
  private readonly framedTarget = new Vector3();
  controls: ControlsLike | null = null;

  private readonly scene: Scene;
  private readonly canvas: RenderTargetCanvas;
  private readonly interactionQuality: InteractionQualityController;
  private readonly onCameraChanged: ((state: CameraState) => void) | undefined;
  private readonly onContextLostCb: (() => void) | undefined;
  private readonly onContextRestoredCb: (() => void) | undefined;
  private contextLost = false;
  private disposedFlag = false;

  private readonly onContextLost = (ev: Event): void => {
    ev.preventDefault();
    this.contextLost = true;
    this.onContextLostCb?.();
  };
  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.onContextRestoredCb?.();
  };

  constructor(opts: InteractiveStageOptions) {
    this.canvas = opts.canvas;
    this.scene = opts.scene;
    this.onCameraChanged = opts.onCameraChanged;
    this.onContextLostCb = opts.onContextLost;
    this.onContextRestoredCb = opts.onContextRestored;

    this.gl = (
      opts.createRenderer ??
      ((canvas) => createDefaultGLRenderer(canvas, { preserveDrawingBuffer: opts.preserveDrawingBuffer }))
    )(opts.canvas);
    this.interactionQuality = new InteractionQualityController(
      { setPixelRatio: (r) => this.gl.setPixelRatio?.(r), render: () => this.render() },
      opts.interactionQuality ?? 'off'
    );

    // Both cameras exist for the stage's lifetime; setCameraMode/frameTo keep their pose in sync so a
    // projection toggle never jumps the view (#150). The ortho frustum is placeholder until frameTo/resize.
    this.perspectiveCamera = new PerspectiveCamera(50, 1, 0.1, 10000);
    this.perspectiveCamera.position.set(-100, 200, 250);
    this.orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    this.orthographicCamera.position.set(-100, 200, 250);
    this.cameraModeState = opts.cameraMode ?? 'perspective';
    this.activeCameraRef = this.cameraModeState === 'orthographic' ? this.orthographicCamera : this.perspectiveCamera;

    const domEl = this.gl.domElement;
    // OrbitControls needs a real DOM element; an OffscreenCanvas (headless still-render) has no pointer
    // events, so there is nothing to orbit.
    if (isHtmlCanvas(domEl)) {
      try {
        const make = opts.createControls ?? ((cam, dom) => new OrbitControls(cam, dom) as unknown as ControlsLike);
        this.controls = make(this.activeCameraRef, domEl);
        // Zoom toward the pointer rather than the orbit target (#267); distance clamps come from frameTo.
        this.controls.zoomToCursor = true;
        // Keyboard-operable camera for embedders (DD-004 a11y, #275/M4), scoped to the canvas.
        this.controls.listenToKeyEvents(domEl);
        this.controls.addEventListener('change', () => this.onInteractionFrame());
        // Two-way camera state (#275/M6): after a gesture settles, publish the new pose. `end` fires once
        // per gesture (not per frame like `change`).
        this.controls.addEventListener('end', () => {
          this.settleInteraction();
          this.onCameraChanged?.(this.getCameraState());
        });
      } catch {
        this.controls = null; // headless hosts without full DOM events
      }
    }

    this.canvas.addEventListener?.('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener?.('webglcontextrestored', this.onContextRestored);
  }

  get activeCamera(): PerspectiveCamera | OrthographicCamera {
    return this.activeCameraRef;
  }
  get cameraMode(): CameraMode {
    return this.cameraModeState;
  }
  get disposed(): boolean {
    return this.disposedFlag;
  }

  /** Size both projections from the tracked aspect + framed half-height (#150). */
  private updateCameraProjection(): void {
    this.perspectiveCamera.aspect = this.aspect;
    this.perspectiveCamera.updateProjectionMatrix();
    const h = this.viewHalfHeight;
    const w = h * this.aspect;
    this.orthographicCamera.left = -w;
    this.orthographicCamera.right = w;
    this.orthographicCamera.top = h;
    this.orthographicCamera.bottom = -h;
    this.orthographicCamera.updateProjectionMatrix();
  }

  /** Switch camera projection (#150, DD-009 D3); the pose is copied so the view never jumps. */
  setCameraMode(mode: CameraMode): void {
    if (this.disposedFlag || mode === this.cameraModeState) return;
    const prev = this.activeCameraRef;
    const next = mode === 'orthographic' ? this.orthographicCamera : this.perspectiveCamera;
    next.position.copy(prev.position);
    next.quaternion.copy(prev.quaternion);
    next.up.copy(prev.up);
    this.cameraModeState = mode;
    this.activeCameraRef = next;
    this.updateCameraProjection();
    if (this.controls) {
      this.controls.object = next;
      this.controls.update();
    }
    this.render();
  }

  /** The live orbit target: `controls.target` when interactive, else the last framed target (#268). */
  private currentTarget(): Vector3 {
    return this.controls ? this.controls.target.clone() : this.framedTarget.clone();
  }

  /** Screen-up for a view direction; world-up is degenerate looking straight up/down, so top/bottom roll about −Z. */
  private upForViewDir(dir: Vector3): Vector3 {
    return Math.abs(dir.y) > 0.999 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  }

  /** Snap to a preset orientation (#268): place the camera on the view's direction at the current distance. */
  setView(view: CameraView): void {
    if (this.disposedFlag) return;
    const dir = new Vector3(...VIEW_DIRECTIONS[view]).normalize();
    const target = this.currentTarget();
    const distance = this.activeCameraRef.position.distanceTo(target) || this.viewHalfHeight * 2.15;
    this.activeCameraRef.up.copy(this.upForViewDir(dir));
    this.activeCameraRef.position.copy(target).addScaledVector(dir, distance);
    this.activeCameraRef.lookAt(target);
    this.framedTarget.copy(target);
    this.updateCameraProjection();
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
    this.render();
  }

  /** Read the current camera as a serializable {@link CameraState} (scene coords, #268). */
  getCameraState(): CameraState {
    const t = this.currentTarget();
    const p = this.activeCameraRef.position;
    return {
      position: { x: p.x, y: p.y, z: p.z },
      target: { x: t.x, y: t.y, z: t.z },
      zoom: this.activeCameraRef.zoom,
      cameraMode: this.cameraModeState
    };
  }

  /** Restore a {@link CameraState} verbatim (#268) — no re-fit to the current model's bounds. */
  setCameraState(state: CameraState): void {
    if (this.disposedFlag) return;
    this.setCameraMode(state.cameraMode); // activates the right camera; no-op if unchanged
    const cam = this.activeCameraRef;
    const target = new Vector3(state.target.x, state.target.y, state.target.z);
    const dir = new Vector3(state.position.x, state.position.y, state.position.z).sub(target).normalize();
    cam.up.copy(this.upForViewDir(dir));
    cam.position.set(state.position.x, state.position.y, state.position.z);
    cam.zoom = state.zoom;
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    this.framedTarget.copy(target);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.update();
    }
    this.render();
  }

  /**
   * Frame the camera to a scene-space center + radius via the shared 3/4 pose (stage.ts), sizing the
   * ortho frustum and the zoom-distance clamps from the framed model so a projection toggle keeps the
   * apparent size and the user can't dolly through/away from the model (#150/#267).
   */
  frameTo(center: Vector3, radius: number): void {
    if (this.disposedFlag) return;
    const { target, position, viewHalfHeight } = framingFromCenterRadius(center, radius);
    this.viewHalfHeight = viewHalfHeight;
    this.framedTarget.copy(target);
    this.activeCameraRef.position.copy(position);
    this.activeCameraRef.lookAt(target);
    this.updateCameraProjection();
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.minDistance = Math.max(1, radius * 0.15);
      this.controls.maxDistance = radius * 30;
      this.controls.update();
    }
    this.render();
  }

  /** Toggle interaction-aware quality (DD-020). `'off'` restores full detail immediately. */
  setInteractionQuality(mode: 'off' | 'auto'): void {
    if (this.disposedFlag) return;
    this.interactionQuality.setMode(mode);
  }

  /** OrbitControls `'change'`: render, and (when auto) adapt detail. */
  onInteractionFrame(): void {
    if (this.disposedFlag) return;
    this.interactionQuality.onFrame();
  }

  /** OrbitControls `'end'`: restore full detail after a debounce. */
  settleInteraction(): void {
    if (this.disposedFlag) return;
    this.interactionQuality.settle();
  }

  resize(width: number, height: number): void {
    if (this.disposedFlag) return;
    this.aspect = width / Math.max(1, height);
    this.updateCameraProjection();
    this.gl.setSize(width, height, false);
    this.render();
  }

  render(): void {
    if (this.disposedFlag || this.contextLost) return;
    this.gl.render(this.scene, this.activeCameraRef);
  }

  /**
   * Capture the currently displayed view as an image `Blob` (DD-030 D1). Renders the current scene +
   * active camera into an off-screen target at the requested size (so it never disturbs the live view
   * nor requires `preserveDrawingBuffer`), reads it back, and encodes it. Rejects with an
   * `E_CAPTURE_UNSUPPORTED` error when the renderer cannot render-to-target (a stub GL / no WebGL) or the
   * stage is disposed / context-lost. The caller owns the returned `Blob` — the library never downloads.
   */
  async capture(opts: CaptureOptions = {}): Promise<Blob> {
    if (this.disposedFlag || this.contextLost || !supportsCapture(this.gl)) {
      const why = this.disposedFlag
        ? 'stage disposed'
        : this.contextLost
          ? 'WebGL context lost'
          : 'renderer cannot render-to-target';
      throw new CaptureUnsupportedError(`capture unavailable: ${why}`);
    }
    const gl = this.gl;
    const { w, h } = resolveCaptureSize(opts, this.canvas.width, this.canvas.height);
    const target = new WebGLRenderTarget(w, h);
    // Frame the capture at its OWN aspect (not the viewport's) so a differently-shaped thumbnail is not
    // distorted; reuse the stage's projection machinery, then restore the live aspect.
    const prevAspect = this.aspect;
    const prevBackground = this.scene.background;
    const overrideBackground = opts.background !== undefined;
    try {
      if (overrideBackground) {
        this.scene.background =
          opts.background === 'transparent' ? null : new Color(opts.background as string | number);
      }
      this.aspect = w / h;
      this.updateCameraProjection();
      gl.setRenderTarget(target);
      gl.render(this.scene, this.activeCameraRef);
      const buffer = new Uint8Array(w * h * 4);
      gl.readRenderTargetPixels(target, 0, 0, w, h, buffer);
      gl.setRenderTarget(null);
      return await encodeRGBAToBlob(flipRowsRGBA(buffer, w, h), w, h, opts.format ?? 'image/png', opts.quality);
    } finally {
      target.dispose();
      if (overrideBackground) this.scene.background = prevBackground;
      this.aspect = prevAspect;
      this.updateCameraProjection();
      this.render(); // repaint the live canvas (we redirected the renderer to a target)
    }
  }

  dispose(): void {
    if (this.disposedFlag) return;
    this.disposedFlag = true;
    this.interactionQuality.dispose();
    this.canvas.removeEventListener?.('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener?.('webglcontextrestored', this.onContextRestored);
    this.controls?.dispose();
    this.gl.dispose();
  }
}
