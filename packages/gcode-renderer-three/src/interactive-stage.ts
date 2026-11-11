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
import { Color, OrthographicCamera, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderTarget } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec3 } from '@chestnutlabs/toolpath-core';
import {
  checkFov,
  checkPixelRatio,
  DEVICE_PIXEL_RATIO_CAP,
  type PixelRatioOption,
  createDefaultGLRenderer,
  framingFromCenterRadius,
  framingLensScale,
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
  /**
   * Resting pixel ratio: a number in (0, 4], or `'device'` (the display's DPR capped at 2, followed live).
   * Unset, the renderer keeps its own ratio. Throws `RangeError` otherwise, before any GL work.
   */
  pixelRatio?: PixelRatioOption;
  /** Injectable display for `'device'` (tests). Default: `globalThis` (the window in a browser). */
  displayEnv?: DisplayEnv;
  /** Preserve the drawing buffer so the canvas is readable after a render (headless still). */
  preserveDrawingBuffer?: boolean;
  /** Injectable GL (tests / exotic hosts). Default: the shared stage builder. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  /** Injectable controls (tests). Default: three `OrbitControls`; skipped on a non-DOM canvas. */
  createControls?: (camera: PerspectiveCamera | OrthographicCamera, domElement: HTMLElement) => ControlsLike;
  /** Emitted once per gesture after the camera settles, with the new pose (#275/M6). */
  onCameraChanged?: (state: CameraState) => void;
  /**
   * Emitted when the USER moves the camera (orbit/zoom/pan by pointer, wheel, touch, or keyboard) —
   * on each such camera change, never for the stage's own programmatic moves, and not for a bare click
   * that leaves the camera where it was.
   */
  onInteractionStart?: () => void;
  /** WebGL context lost — the owner should treat GPU resources as gone. */
  onContextLost?: () => void;
  /** WebGL context restored — the owner rebuilds its scene content here. */
  onContextRestored?: () => void;
}

/** The slice of `window` the `'device'` pixel ratio reads: the DPR and a `resolution` media query. */
export interface DisplayEnv {
  readonly devicePixelRatio?: number;
  matchMedia?(query: string): MediaQueryListLike;
}

/** The slice of `MediaQueryList` the DPR watcher uses. */
export interface MediaQueryListLike {
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/**
 * Follows `devicePixelRatio` for `pixelRatio: 'device'`. A `(resolution: Xdppx)` query only reports
 * leaving the ratio X, so each change re-arms a query for the new ratio. With no `matchMedia` (a worker,
 * a headless host) the ratio is read once and not followed.
 */
class DevicePixelRatioWatcher {
  private query: MediaQueryListLike | null = null;
  private readonly onChange = (): void => {
    this.arm();
    this.notify(this.read());
  };

  constructor(
    private readonly env: DisplayEnv | undefined,
    private readonly notify: (ratio: number) => void
  ) {
    this.arm();
  }

  /** The display ratio, capped at {@link DEVICE_PIXEL_RATIO_CAP}; 1 when the host reports none. */
  read(): number {
    const dpr = this.env?.devicePixelRatio;
    return typeof dpr === 'number' && dpr > 0 ? Math.min(dpr, DEVICE_PIXEL_RATIO_CAP) : 1;
  }

  private arm(): void {
    this.disarm();
    const dpr = this.env?.devicePixelRatio;
    if (typeof this.env?.matchMedia !== 'function' || typeof dpr !== 'number' || !(dpr > 0)) return;
    this.query = this.env.matchMedia(`(resolution: ${dpr}dppx)`);
    this.query.addEventListener('change', this.onChange);
  }

  private disarm(): void {
    this.query?.removeEventListener('change', this.onChange);
    this.query = null;
  }

  dispose(): void {
    this.disarm();
  }
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
  /** True while the stage itself drives `controls.update()`, so its `change` is not read as a user move. */
  private programmaticMove = false;
  /** Lens dolly owed to the perspective camera for a `setFov` made while orthographic (DD-032). */
  private pendingLensScale = 1;
  /** The resolved resting ratio from the `pixelRatio` option, or null when unset (the renderer's own). */
  private hostRatio: number | null = null;
  private readonly displayEnv: DisplayEnv | undefined;
  /** Live only while the option is `'device'`. */
  private dprWatcher: DevicePixelRatioWatcher | null = null;

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
    // Validate before any GL resource exists, so a bad value never leaks a context.
    if (opts.pixelRatio !== undefined) checkPixelRatio(opts.pixelRatio);
    this.displayEnv = opts.displayEnv ?? (globalThis as DisplayEnv);
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
      {
        setPixelRatio: (r) => this.gl.setPixelRatio?.(r),
        // The consumer's ratio, once set, is the resting one; unset, the renderer's own (#435).
        getPixelRatio: () => this.hostRatio ?? this.gl.getPixelRatio?.() ?? 1,
        render: () => this.render()
      },
      opts.interactionQuality ?? 'off'
    );
    if (opts.pixelRatio !== undefined) this.applyPixelRatioOption(opts.pixelRatio);

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
        // OrbitControls fires `change` for pointer, wheel, touch AND keyboard moves (keyboard dispatches no
        // `start`/`end`), so user intent is "a `change` the stage did not cause itself".
        const onUserMove = opts.onInteractionStart;
        this.controls.addEventListener('change', () => {
          // The stage's own moves (fit, view presets) are a single repaint, never an interaction frame:
          // they get no `end`, so DD-020's reduced detail would never be restored.
          if (this.programmaticMove) return;
          onUserMove?.();
          this.onInteractionFrame();
        });
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
      this.updateControls();
    }
    // A lens set while orthographic takes its dolly now, on the way back to perspective.
    if (mode === 'perspective' && this.pendingLensScale !== 1) {
      const scale = this.pendingLensScale;
      this.pendingLensScale = 1;
      this.applyLensDolly(scale);
    }
    this.render();
  }

  /** `controls.update()` on behalf of the stage (programmatic, not a user gesture). */
  private updateControls(): void {
    if (!this.controls) return;
    this.programmaticMove = true;
    try {
      this.controls.update();
    } finally {
      this.programmaticMove = false;
    }
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
      this.updateControls();
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

  /** The perspective camera's vertical field of view, degrees (default 50). */
  get fov(): number {
    return this.perspectiveCamera.fov;
  }

  /**
   * Change the perspective lens (DD-032) without a re-fit: the target stays and the camera distance is
   * scaled by framingLensScale(new)/framingLensScale(old), the same factor framing uses, so a framed view
   * after setFov(f) equals a fresh frame at f. It keeps the apparent size at ≤50°; above 50° it keeps the
   * frame margin instead (a pure tan dolly would put the camera inside the model). The zoom-distance limits
   * scale by the same factor, so the dolly is never clamped. In orthographic mode the view is untouched;
   * the value is kept and its dolly is applied on the next switch back to perspective. Programmatic: never
   * emits camera-changed. Throws `RangeError` for a `fov` outside [10, 120] — it never clamps.
   */
  setFov(fov: number): void {
    checkFov(fov);
    if (this.disposedFlag || fov === this.perspectiveCamera.fov) return;
    const scale = framingLensScale(fov) / framingLensScale(this.perspectiveCamera.fov);
    this.perspectiveCamera.fov = fov;
    this.perspectiveCamera.updateProjectionMatrix();
    if (this.cameraModeState !== 'perspective') {
      this.pendingLensScale *= scale;
      return;
    }
    this.applyLensDolly(scale);
    this.render();
  }

  /** Dolly the perspective camera along its view line by `scale` (target fixed) and scale the limits. */
  private applyLensDolly(scale: number): void {
    const target = this.currentTarget();
    const offset = this.perspectiveCamera.position.clone().sub(target);
    this.perspectiveCamera.position.copy(target).add(offset.multiplyScalar(scale));
    this.perspectiveCamera.lookAt(target);
    if (this.controls) {
      if (this.controls.minDistance !== undefined) this.controls.minDistance *= scale;
      if (this.controls.maxDistance !== undefined) this.controls.maxDistance *= scale;
      this.updateControls();
    }
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
      this.updateControls();
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
    const { target, position, viewHalfHeight } = framingFromCenterRadius(center, radius, this.perspectiveCamera.fov);
    // This pose is already for the current lens: a dolly owed from an earlier ortho setFov is void.
    this.pendingLensScale = 1;
    this.viewHalfHeight = viewHalfHeight;
    this.framedTarget.copy(target);
    this.activeCameraRef.position.copy(position);
    this.activeCameraRef.lookAt(target);
    this.updateCameraProjection();
    if (this.controls) {
      this.controls.target.copy(target);
      // The limits follow the lens (the framed distance does), so controls.update() never crops the frame.
      const k = framingLensScale(this.perspectiveCamera.fov);
      this.controls.minDistance = Math.max(1, radius * 0.15) * k;
      this.controls.maxDistance = radius * 30 * k;
      this.updateControls();
    }
    this.render();
  }

  /**
   * Fit a scene-space axis-aligned box to the viewport: the camera looks at the box center along
   * `direction` (target→camera; default the shared 3/4 pose) and backs off just far enough that every
   * corner lands inside BOTH the vertical and the horizontal field of view at the current aspect, with
   * `margin` (≥1, default 1.1) of slack. The orthographic frustum is sized to the same projected extent,
   * so a projection toggle keeps the apparent size. Unlike {@link frameTo}'s bounding-sphere pose this
   * is tight: a wide/flat model fills a wide canvas instead of overflowing a narrow one.
   */
  fitBox(min: Vector3, max: Vector3, opts: { direction?: Vector3; margin?: number } = {}): void {
    if (this.disposedFlag) return;
    const margin = Math.max(1, opts.margin ?? 1.1);
    const target = new Vector3().addVectors(min, max).multiplyScalar(0.5);
    const radius = Math.max(1e-3, target.distanceTo(max));
    const dir = (opts.direction?.clone() ?? new Vector3(-1.2, 1.6, 1.8)).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() === 0) dir.set(-1.2, 1.6, 1.8).normalize();
    const up = this.upForViewDir(dir);
    // Camera basis: d points at the camera, r/u span the image plane.
    const right = new Vector3().crossVectors(up, dir).normalize();
    const camUp = new Vector3().crossVectors(dir, right);
    if (!(this.aspect > 0) || !Number.isFinite(this.aspect)) return; // no viewport to fit (hidden canvas)
    const tanV = Math.tan(((this.perspectiveCamera.fov / 2) * Math.PI) / 180) / margin;
    const tanH = tanV * this.aspect;
    // Corners in camera-basis coords relative to the box center: x right, y up, z toward the camera.
    const corners: [number, number, number][] = [];
    let halfW = 0;
    let halfH = 0;
    const p = new Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).sub(target);
      const c: [number, number, number] = [p.dot(right), p.dot(camUp), p.dot(dir)];
      corners.push(c);
      halfW = Math.max(halfW, Math.abs(c[0]));
      halfH = Math.max(halfH, Math.abs(c[1]));
    }
    // Perspective: nearer corners project larger, so the box center is not the centre of its image. Slide
    // the target across the image plane (ox, oy) until the projected extent is centred, re-solving the
    // distance each pass so every corner sits inside both FOVs. Converges in a few passes.
    let ox = 0;
    let oy = 0;
    let distance: number;
    const solveDistance = (): number => {
      let d = radius * 0.5;
      for (const [x, y, z] of corners) d = Math.max(d, z + Math.abs(x - ox) / tanH, z + Math.abs(y - oy) / tanV);
      return d;
    };
    const perspective = this.activeCameraRef === this.perspectiveCamera;
    distance = solveDistance();
    for (let pass = 0; perspective && pass < 6; pass++) {
      let uMin = Infinity;
      let uMax = -Infinity;
      let vMin = Infinity;
      let vMax = -Infinity;
      for (const [x, y, z] of corners) {
        const depth = Math.max(1e-6, distance - z);
        const u = (x - ox) / depth;
        const v = (y - oy) / depth;
        uMin = Math.min(uMin, u);
        uMax = Math.max(uMax, u);
        vMin = Math.min(vMin, v);
        vMax = Math.max(vMax, v);
      }
      ox += ((uMin + uMax) / 2) * distance;
      oy += ((vMin + vMax) / 2) * distance;
      distance = solveDistance();
    }
    target.addScaledVector(right, ox).addScaledVector(camUp, oy);
    // Keep the whole box inside the depth range for very large models.
    const far = Math.max(10000, (distance + radius * 2) * 1.05);
    this.perspectiveCamera.far = far;
    this.orthographicCamera.far = far;
    this.viewHalfHeight = Math.max(1e-3, Math.max(halfH, halfW / Math.max(1e-6, this.aspect)) * margin);
    this.pendingLensScale = 1; // solved for the current lens: any dolly owed from an ortho setFov is void
    this.framedTarget.copy(target);
    const cam = this.activeCameraRef;
    cam.up.copy(up);
    cam.zoom = 1;
    cam.position.copy(target).addScaledVector(dir, distance);
    cam.lookAt(target);
    this.updateCameraProjection();
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.minDistance = Math.max(1, radius * 0.15);
      this.controls.maxDistance = Math.max(distance * 4, radius * 30);
      this.updateControls();
    }
    this.render();
  }

  /** The current view direction (orbit target → camera, unit). */
  viewDirection(): Vector3 {
    return this.activeCameraRef.position.clone().sub(this.currentTarget()).normalize();
  }

  /** Toggle interaction-aware quality (DD-020). `'off'` restores full detail immediately. */
  setInteractionQuality(mode: 'off' | 'auto'): void {
    if (this.disposedFlag) return;
    this.interactionQuality.setMode(mode);
  }

  /**
   * Set the resting pixel ratio: a number in (0, 4], or `'device'` (the display's DPR capped at 2, then
   * followed live as it changes). Goes through the interaction-quality controller, so a gesture in
   * progress keeps its reduction and its settle restores the new ratio. Throws `RangeError` otherwise
   * (never clamps). The default {@link capture} size stays the CSS size: pass `width`/`height` for a
   * larger image.
   */
  setPixelRatio(ratio: PixelRatioOption): void {
    checkPixelRatio(ratio);
    if (this.disposedFlag) return;
    this.applyPixelRatioOption(ratio);
  }

  private applyPixelRatioOption(ratio: PixelRatioOption): void {
    this.dprWatcher?.dispose();
    this.dprWatcher = null;
    if (ratio === 'device') {
      this.dprWatcher = new DevicePixelRatioWatcher(this.displayEnv, (r) => this.rebaseRatio(r));
      this.rebaseRatio(this.dprWatcher.read());
    } else {
      this.rebaseRatio(ratio);
    }
  }

  private rebaseRatio(ratio: number): void {
    if (this.disposedFlag) return;
    const before = this.interactionQuality.currentRatio;
    this.hostRatio = ratio;
    this.interactionQuality.rebase(ratio);
    // A new ratio resizes (and so clears) the drawing buffer: repaint it.
    if (this.interactionQuality.currentRatio !== before) this.render();
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
    // A hidden (0×0) canvas keeps the last real aspect, so framing done meanwhile stays valid.
    if (width > 0 && height > 0) this.aspect = width / height;
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
   * With no `width`/`height` the image is the canvas's CSS size, whatever the pixel ratio (and also
   * mid-gesture); pass `width`/`height` for a crisper image.
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
    // The default size is the CSS size: the drawing buffer divided by the ratio applied right now (the
    // reduced one mid-gesture), so a pixelRatio never changes what an unsized capture() returns.
    const applied = this.interactionQuality.currentRatio;
    const { w, h } = resolveCaptureSize(opts, this.canvas.width / applied, this.canvas.height / applied);
    // The render target's texture MUST declare sRGB so three applies the same linear→sRGB output
    // encoding it gives the canvas. A default (NoColorSpace/linear) target makes readRenderTargetPixels
    // return LINEAR bytes — the whole capture (background AND geometry colours) comes back too dark
    // (e.g. #6d7176 → ~#272a2e), diverging from the canvas view and from renderStill's toDataURL path.
    const target = new WebGLRenderTarget(w, h);
    target.texture.colorSpace = SRGBColorSpace;
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
    this.dprWatcher?.dispose();
    this.dprWatcher = null;
    this.interactionQuality.dispose();
    this.canvas.removeEventListener?.('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener?.('webglcontextrestored', this.onContextRestored);
    this.controls?.dispose();
    this.gl.dispose();
  }
}
