/**
 * ToolpathRenderer — scene, lifecycle, camera, incremental build (DD-004 §4.2/§5, phase 2, issue #57).
 *
 * Structure:
 *   scene
 *   └─ root (rotation.x = -π/2: the single Z-up→Y-up conversion, §6.2 — everything
 *      below speaks printer coordinates)
 *      ├─ buildVolume (grid/box/origin, printer space)
 *      └─ toolpath (positioned at ir.header.originOffset; children are chunk
 *         LineSegments whose geometry is the phase-1 origin-relative buffers)
 *
 * Lifecycle (§5): `setIR` retains the IR (the canonical source), builds geometry
 * chunks incrementally across scheduler ticks (§5.3 — bounded work per tick, the
 * DD-003 cooperative principle applied to uploads), renders on demand, recovers
 * from WebGL context loss by rebuilding from the retained IR (§5.2), and disposes
 * every GPU resource it created.
 *
 * Testability: the WebGL renderer and the frame scheduler are injectable; tests
 * drive ticks synchronously against a stub renderer (no GL needed — three's
 * scene graph and BufferGeometry are pure JS).
 */
import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MachineGeometry, MappedProgress, ToolpathIR, Vec3 } from '@chestnutlabs/toolpath-core';
import { autoDecimation, buildChunks, type ChunkBuildResult, type GeometryChunk } from './chunks.js';
import { buildChunkColors, type ColorMode } from './colors.js';
import { computeDrawState, computeOverlayDrawStates } from './ranges.js';
import { createBuildVolume, type BuildVolumeDef, type BuildVolumeStyle } from './build-volume.js';
import { buildTubeChunk, TUBES_AUTO_MAX_SEGMENTS, type TubeOptions } from './tubes.js';
import { resolveTheme, type Theme, type ResolvedTheme } from './theme.js';

/** §4.3 quality tiers. `auto` picks by segment count (chooseQuality). */
export type QualityMode = 'lines' | 'tubes';

/**
 * Camera projection (#150, DD-009 D3). `perspective` is the default interactive
 * view; `orthographic` gives parallel-projection technical/dimensional views.
 * Switching preserves the view direction, target, and apparent framing.
 */
export type CameraMode = 'perspective' | 'orthographic';

/**
 * Preset orientations for {@link ToolpathRenderer.setView} (#268). `iso` is the standard
 * front-top-right corner; the six orthogonal views look along a principal axis.
 */
export type CameraView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

/**
 * A serializable snapshot of the camera (#268), in **scene coordinates**. A stable contract a
 * dashboard may persist across sessions: {@link ToolpathRenderer.getCameraState} reads it and
 * {@link ToolpathRenderer.setCameraState} restores it verbatim (no re-fit to the current model —
 * restoring onto a different model is the caller's choice).
 */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  /** Camera zoom factor (three's `camera.zoom`); mainly meaningful for the orthographic view. */
  zoom: number;
  cameraMode: CameraMode;
}

/**
 * Unit direction (scene coords) from the framed target to the camera for each preset (#268). The
 * root rotation maps printer (x,y,z) → scene (x, z, -y), so e.g. printer +Z "up" is scene +Y.
 */
const VIEW_DIRECTIONS: Record<CameraView, readonly [number, number, number]> = {
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  iso: [1, 1, 1]
};

/** §4.3 `auto` decision, exported for tests and consumers. */
export function chooseQuality(requested: QualityMode | 'auto', totalSegments: number): QualityMode {
  if (requested !== 'auto') return requested;
  return totalSegments <= TUBES_AUTO_MAX_SEGMENTS ? 'tubes' : 'lines';
}

/** How the live-progress overlay is currently presented (DD-006 §4.5). */
export type ProgressPresentationMode = 'exact' | 'band' | 'stale' | 'hidden';

export type RendererEvent =
  | { type: 'buildProgress'; chunksBuilt: number; chunksTotal: number }
  | { type: 'progress-presentation-changed'; mode: ProgressPresentationMode; reason?: string }
  | {
      type: 'buildComplete';
      segments: number;
      decimationApplied: number;
      travelHidden: boolean;
      quality: QualityMode;
    }
  | { type: 'qualityFallback'; from: QualityMode; to: QualityMode; reason: string }
  | { type: 'previewAppend'; cumulativeSegments: number; decimationApplied: number }
  | { type: 'contextlost' }
  | { type: 'restored' }
  /** The camera settled after a user interaction (orbit/pan/zoom/key) — carries the new serializable
   *  state so a consumer can persist "where the user was looking" (#275/M6). Programmatic setView /
   *  setCameraState do NOT emit this (they are consumer-driven already), so a bound prop can't loop. */
  | { type: 'camera-changed'; state: CameraState }
  | { type: 'error'; code: string; message: string };

/**
 * Render target: a DOM canvas (interactive hosts) or an OffscreenCanvas
 * (workers / headless still-render, #132). Both are EventTargets with WebGL2,
 * so the scene layer treats them uniformly.
 */
export type RenderTargetCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Minimal surface of WebGLRenderer the scene layer uses — injectable for tests. */
export interface GLRendererLike {
  // Base `Camera`, not `PerspectiveCamera`: the active camera may be either
  // projection (#150). Every stub GL ignores the arg, so this only widens types.
  render(scene: Scene, camera: Camera): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio?(ratio: number): void;
  dispose(): void;
  domElement: RenderTargetCanvas;
}

export interface ToolpathRendererOptions {
  canvas: RenderTargetCanvas;
  buildVolume?: BuildVolumeDef;
  /**
   * Count-based tick override (tests/deterministic hosts): exactly N chunks per
   * tick. Default (unset): TIME-budgeted ticks — chunks build until ~8 ms of
   * work has elapsed (§8: no main-thread stall > 16 ms during incremental build).
   */
  chunksPerTick?: number;
  colorMode?: ColorMode;
  /** §4.3 quality tier; 'auto' (default) picks tubes ≤ 1 M segments, else lines. */
  quality?: QualityMode | 'auto';
  /** Camera projection (#150, DD-009 D3); default 'perspective'. */
  cameraMode?: CameraMode;
  /** Tube profile parameters (tubes mode only). */
  tube?: TubeOptions;
  /** Bounded declarative theme (#153, DD-009 D4); omitted fields keep the default look. */
  theme?: Theme;
  /**
   * Preserve the WebGL drawing buffer so the canvas can be read back after a
   * render returns (`toDataURL` / `convertToBlob` / `readPixels`). Off by
   * default (interactive rendering is faster without it); the headless
   * still-render path (#132) turns it on so a single render is capturable.
   */
  preserveDrawingBuffer?: boolean;
  /** Injectables for tests / exotic hosts. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  scheduleFrame?: (cb: () => void) => void;
}

const DEFAULT_COLOR: ColorMode = { mode: 'single', color: [0.9, 0.4, 0.7] };

/** Discovered machine geometry → renderable volume (bounding volume for circular/polygon beds, v1). */
export function machineToVolume(m: MachineGeometry): BuildVolumeDef {
  const bed = m.bed;
  const excludedRegions = m.excludedRegions;
  if (bed.kind === 'rect') {
    return {
      x: bed.max.x - bed.min.x,
      y: bed.max.y - bed.min.y,
      z: m.heightMm ?? 250,
      min: { ...bed.min },
      excludedRegions
    };
  }
  if (bed.kind === 'circular') {
    const r = bed.diameter / 2;
    return {
      x: bed.diameter,
      y: bed.diameter,
      z: m.heightMm ?? 250,
      min: { x: bed.center.x - r, y: bed.center.y - r },
      excludedRegions
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of bed.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: maxX - minX, y: maxY - minY, z: m.heightMm ?? 250, min: { x: minX, y: minY }, excludedRegions };
}

/** True for a real DOM canvas (has DOM-only members OffscreenCanvas lacks). */
function isHtmlCanvas(c: RenderTargetCanvas): c is HTMLCanvasElement {
  return typeof (c as Partial<HTMLCanvasElement>).addEventListener === 'function' && 'style' in c;
}

/** §8-derived tick budget: half the 16 ms stall budget, leaving frame headroom. */
const TICK_BUDGET_MS = 8;
/** Tubes chunk target: ~2k segments keeps a single tube-chunk build under the stall budget. */
const TUBES_CHUNK_TARGET = 2048;

/**
 * Map a raycast hit on a toolpath chunk mesh — identified by its hit vertex index — back to the IR
 * segment index (#184, the "click a segment → source line" half). Lines mode has 2 vertices per
 * segment; tube meshes carry a `vertexSegment` table (vertex → in-chunk segment). Returns null when
 * the mesh isn't a pickable chunk or the index is out of range. Pure — testable without a GL context.
 */
export function resolveHitSegment(mesh: LineSegments | Mesh, vertexIndex: number): number | null {
  const chunk = mesh.userData.chunk as GeometryChunk | undefined;
  if (chunk === undefined) return null;
  const vertexSegment = mesh.userData.vertexSegment as Uint32Array | undefined;
  const inChunk = vertexSegment !== undefined ? vertexSegment[vertexIndex] : Math.floor(vertexIndex / 2);
  if (inChunk === undefined || inChunk < 0 || inChunk >= chunk.count) return null;
  return chunk.segIndices[inChunk];
}

export class ToolpathRenderer {
  private readonly canvas: RenderTargetCanvas;
  private readonly gl: GLRendererLike;
  private readonly scheduleFrame: (cb: () => void) => void;
  private readonly chunksPerTick: number | undefined;

  private readonly scene = new Scene();
  private readonly root = new Group();
  private readonly toolpathGroup = new Group();
  private volumeGroup: Group | null = null;
  private volumeDef: BuildVolumeDef | null = null;
  // Themeable scene objects (#153): lights + resolved theme, retained so setTheme
  // can restyle them live. Materials for tube geometry are made per-chunk.
  private readonly hemiLight: HemisphereLight;
  private readonly dirLight: DirectionalLight;
  private resolvedTheme: ResolvedTheme;
  // Two persistent cameras sharing one pose (#150); only the projection differs.
  // `activeCamera` is the one currently rendered/orbited; the public `camera`
  // getter returns it as the union (external readers must not assume a `.fov`).
  private readonly perspectiveCamera: PerspectiveCamera;
  private readonly orthographicCamera: OrthographicCamera;
  private activeCamera: PerspectiveCamera | OrthographicCamera;
  private cameraModeState: CameraMode;
  /** Viewport aspect (w/h), tracked so both projections resize consistently. */
  private aspect = 1;
  /** Vertical half-height the camera frames, set by frame(); sizes the ortho frustum. */
  private viewHalfHeight = 100;
  /** Last framed orbit target (scene coords). Mirrors `controls.target`, and stands in for it on
   *  headless hosts (no OrbitControls) so setView/getCameraState work there too (#268). */
  private framedTarget = new Vector3();
  private controls: OrbitControls | null = null;

  private ir: ToolpathIR | null = null;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private buildResult: ChunkBuildResult | null = null;
  private pendingChunks: GeometryChunk[] = [];
  private builtCount = 0;
  private colorMode: ColorMode;
  // §4.3 quality state: what the consumer asked for vs what is actually built.
  private requestedQuality: QualityMode | 'auto';
  private active: QualityMode = 'lines';
  private readonly tubeOptions: TubeOptions;
  // Progressive-preview state (#60): transient meshes replaced by the final IR.
  private previewSegments = 0;
  private previewBounds: { min: Vector3; max: Vector3 } | null = null;
  // Clipping state (§4.5): draw-range trims only — geometry is never rebuilt here.
  private startLayer = 0;
  private endLayer = Infinity;
  private scrubSegIndex: number | null = null;
  private kindVisible: Record<GeometryChunk['kind'], boolean> = { extrude: true, travel: true, wipe: true };
  // Live-progress overlay state (DD-006 §4.5, phase 3): completed cut + ghost + marker/band.
  private progress: MappedProgress | null = null;
  private presentationMode: ProgressPresentationMode = 'hidden';
  private markerMesh: Mesh | null = null;
  // Shared overlay materials (created once; disposed with the renderer). The ghost is a
  // uniform desaturated translucent pass; the band is the "somewhere in here" emphasis.
  private readonly ghostMaterial = new LineBasicMaterial({
    color: 0x8a94a0,
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  });
  private readonly bandMaterial = new LineBasicMaterial({ color: 0xffa000, transparent: true, opacity: 0.9 });
  private readonly staleBandMaterial = new LineBasicMaterial({ color: 0x9e9e9e, transparent: true, opacity: 0.5 });
  // Marker materials render on top (depthTest off, transparent pass + high renderOrder so
  // they draw AFTER the ghost lines): the marker is a position INDICATOR — half-buried in
  // the extrusion it sits on and behind nearer path lines, it would otherwise be invisible.
  private readonly markerMaterial = new MeshBasicMaterial({
    color: 0xff6d00,
    transparent: true, // joins the transparent pass — sorted after the ghost via renderOrder
    depthTest: false
  });
  private readonly staleMarkerMaterial = new MeshBasicMaterial({
    color: 0x9e9e9e,
    transparent: true,
    opacity: 0.7,
    depthTest: false
  });
  // Retraction markers (DD-009 D1, #148): opt-in points at retract/unretract events.
  // Always-on-top like the progress marker; retract vs unretract by vertex color.
  private showRetractions = false;
  private retractionPoints: Points | null = null;
  private retractionSegIndices: Uint32Array = new Uint32Array(0);
  private readonly retractionMaterial = new PointsMaterial({
    size: 6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthTest: false
  });
  private listeners = new Set<(e: RendererEvent) => void>();
  private disposed = false;
  private contextLost = false;

  private readonly onContextLost = (ev: Event): void => {
    ev.preventDefault();
    this.contextLost = true;
    this.emit({ type: 'contextlost' });
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    // Rebuild all GPU-facing resources from the retained IR — the canonical source (§5.2).
    if (this.ir !== null) {
      this.startBuild(this.ir);
    }
    this.emit({ type: 'restored' });
  };

  constructor(opts: ToolpathRendererOptions) {
    this.canvas = opts.canvas;
    this.chunksPerTick = opts.chunksPerTick;
    this.colorMode = opts.colorMode ?? DEFAULT_COLOR;
    this.requestedQuality = opts.quality ?? 'auto';
    this.tubeOptions = opts.tube ?? {};
    // Default scheduler: rAF for frame alignment, with a timeout backstop so
    // work still progresses when rAF is suspended (hidden/throttled tabs —
    // otherwise a parse finishing in a background tab would never finish
    // uploading). Whichever fires first runs the callback exactly once.
    this.scheduleFrame =
      opts.scheduleFrame ??
      ((cb) => {
        let ran = false;
        const run = (): void => {
          if (ran) return;
          ran = true;
          cb();
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        setTimeout(run, 50);
      });
    this.gl = (
      opts.createRenderer ??
      ((canvas) =>
        new WebGLRenderer({
          canvas: canvas as HTMLCanvasElement,
          antialias: true,
          preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false
        }))
    )(opts.canvas);

    // Single Z-up→Y-up conversion (§6.2); everything below is printer coordinates.
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    this.root.add(this.toolpathGroup);
    // Theme (#153) resolved once; lights + background + volume derive from it.
    this.resolvedTheme = resolveTheme(opts.theme);
    const t = this.resolvedTheme;
    // Lights for tubes mode (lit MeshLambert); LineBasicMaterial ignores them.
    this.hemiLight = new HemisphereLight(t.hemisphereSky, t.hemisphereGround, t.hemisphereIntensity);
    this.scene.add(this.hemiLight);
    this.dirLight = new DirectionalLight(t.directionalColor, t.directionalIntensity);
    this.dirLight.position.set(1, 2, 1.5); // fixed scene-space key light; not themed
    this.scene.add(this.dirLight);
    this.applyBackground();
    if (opts.buildVolume) {
      this.volumeDef = opts.buildVolume;
      this.volumeGroup = createBuildVolume(opts.buildVolume, this.volumeStyle());
      this.root.add(this.volumeGroup);
    }

    // Both cameras exist for the renderer's lifetime; frame()/setCameraMode keep
    // their pose in sync so toggling projection never jumps the view (#150). The
    // ortho frustum is a placeholder until frame()/resize size it from bounds+aspect.
    this.perspectiveCamera = new PerspectiveCamera(50, 1, 0.1, 10000);
    this.perspectiveCamera.position.set(-100, 200, 250);
    this.orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    this.orthographicCamera.position.set(-100, 200, 250);
    this.cameraModeState = opts.cameraMode ?? 'perspective';
    this.activeCamera = this.cameraModeState === 'orthographic' ? this.orthographicCamera : this.perspectiveCamera;
    const domEl = this.gl.domElement;
    // OrbitControls needs a real DOM element; an OffscreenCanvas (headless
    // still-render, #132) has no pointer events, so there is nothing to orbit.
    if (isHtmlCanvas(domEl)) {
      try {
        this.controls = new OrbitControls(this.activeCamera, domEl);
        // Zoom toward the pointer rather than the orbit target — the affordance users expect from a
        // 3D viewer, and free inside OrbitControls (#267). Distance clamps are derived from the framed
        // model size and (re)applied in frame(), since they change per file.
        this.controls.zoomToCursor = true;
        this.controls.addEventListener('change', () => this.render());
        // Two-way camera state (#275/M6): after a user interaction settles, publish the new pose so a
        // bound `cameraState` can persist it. `end` fires once per gesture (not per frame like `change`).
        this.controls.addEventListener('end', () =>
          this.emit({ type: 'camera-changed', state: this.getCameraState() })
        );
      } catch {
        this.controls = null; // headless hosts without full DOM events
      }
    } else {
      this.controls = null;
    }

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.frame(); // sensible initial view (bed-centered until an IR arrives)
  }

  /**
   * The camera currently rendered/orbited (#150). Its concrete type follows
   * `cameraMode`, so external readers must treat it as the union — only
   * perspective cameras carry `.fov` (guard writes on `cameraMode`).
   */
  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.activeCamera;
  }

  /** The active camera projection (#150). */
  get cameraMode(): CameraMode {
    return this.cameraModeState;
  }

  onEvent(cb: (e: RendererEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: RendererEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  /**
   * Progressive preview (#60): append a path-aligned partial slice as transient
   * geometry. Slices always render as lines (cheap, allocation-light) with
   * cumulative every-Nth decimation past the §4.4 thresholds; the eventual
   * `setIR(finalIR)` REPLACES the whole preview set. Preview meshes ignore
   * layer-range/scrub clipping (their indices are slice-local); kind visibility
   * still applies.
   */
  appendPartial(slice: ToolpathIR): void {
    if (this.disposed || slice.segments.count === 0) return;
    if (this.ir !== null) {
      // Partials for a NEW parse while an old final IR is on screen: the old
      // scene is stale — drop it and start the preview fresh.
      this.ir = null;
      this.buildResult = null;
      this.clearToolpathGeometry();
    }
    const firstPartial = this.previewSegments === 0;
    this.previewSegments += slice.segments.count;
    const decimation = autoDecimation(this.previewSegments);
    let result: ChunkBuildResult;
    try {
      result = buildChunks(slice, { decimation });
    } catch (err) {
      this.emit({ type: 'error', code: 'E_PREVIEW_BUILD', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    for (const chunk of result.chunks) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3));
      geometry.setAttribute('color', new BufferAttribute(buildChunkColors(slice, chunk, this.colorMode), 3));
      const mesh = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true }));
      mesh.name = `preview:${chunk.kind}`;
      mesh.userData.chunk = chunk;
      mesh.userData.preview = true;
      mesh.visible = this.kindVisible[chunk.kind];
      this.toolpathGroup.add(mesh);
    }
    const o = slice.header.originOffset;
    this.toolpathGroup.position.set(o.x, o.y, o.z);
    // Track bounds for camera framing before the final IR exists.
    const b = slice.boundsWithTravel;
    if (Number.isFinite(b.min.x)) {
      if (this.previewBounds === null) {
        this.previewBounds = {
          min: new Vector3(b.min.x, b.min.y, b.min.z),
          max: new Vector3(b.max.x, b.max.y, b.max.z)
        };
      } else {
        this.previewBounds.min.min(new Vector3(b.min.x, b.min.y, b.min.z));
        this.previewBounds.max.max(new Vector3(b.max.x, b.max.y, b.max.z));
      }
    }
    this.emit({ type: 'previewAppend', cumulativeSegments: this.previewSegments, decimationApplied: decimation });
    if (firstPartial) this.frame();
    else this.render();
  }

  /** Retain the IR and (re)build the scene from it incrementally. */
  setIR(ir: ToolpathIR): void {
    if (this.disposed) return;
    this.ir = ir;
    // Layer/segment counts belong to the old IR — reset clipping to "show everything".
    this.startLayer = 0;
    this.endLayer = Infinity;
    this.scrubSegIndex = null;
    // A mapped progress refers to the OLD IR's segment indices — never carry it across.
    this.progress = null;
    if (this.presentationMode !== 'hidden') {
      this.presentationMode = 'hidden';
      this.emit({ type: 'progress-presentation-changed', mode: 'hidden', reason: 'new-ir' });
    }
    this.buildRetractionMarkers();
    this.updateRetractionMarkers();
    this.startBuild(ir);
    this.positionToolpath(ir);
    this.frame();
  }

  private positionToolpath(ir: ToolpathIR): void {
    const o = ir.header.originOffset;
    this.toolpathGroup.position.set(o.x, o.y, o.z);
  }

  private startBuild(ir: ToolpathIR): void {
    this.clearToolpathGeometry();
    try {
      this.buildResult = buildChunks(ir, { decimation: 'auto' });
    } catch (err) {
      this.emit({ type: 'error', code: 'E_GEOMETRY_BUILD', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    this.active = chooseQuality(this.requestedQuality, this.buildResult.totalSegmentsIncluded);
    if (this.active === 'tubes') {
      // Tube geometry is ~50× the build cost of lines: rebuild with a small
      // chunk target so no single chunk can exceed the §8 stall budget.
      try {
        this.buildResult = buildChunks(ir, { decimation: 'auto', targetSegmentsPerChunk: TUBES_CHUNK_TARGET });
      } catch (err) {
        this.emit({
          type: 'error',
          code: 'E_GEOMETRY_BUILD',
          message: err instanceof Error ? err.message : String(err)
        });
        return;
      }
    }
    this.pendingChunks = [...this.buildResult.chunks];
    this.builtCount = 0;
    this.scheduleFrame(() => this.buildTick());
  }

  /** A failed tubes build degrades to lines — evented, never silent (§6.1). */
  private fallbackToLines(reason: string): void {
    this.emit({ type: 'qualityFallback', from: 'tubes', to: 'lines', reason });
    this.active = 'lines';
    this.clearToolpathGeometry();
    if (this.ir !== null) {
      // Re-chunk at the lines-mode target (the tubes build used small chunks).
      try {
        this.buildResult = buildChunks(this.ir, { decimation: 'auto' });
      } catch {
        this.buildResult = null;
      }
    }
    if (this.buildResult !== null) {
      this.pendingChunks = [...this.buildResult.chunks];
      this.scheduleFrame(() => this.buildTick());
    }
  }

  /** Expand per-segment colors (6 floats/seg) to tube ring vertices. */
  private tubeVertexColors(chunk: GeometryChunk, vertexSegment: Uint32Array): Float32Array {
    if (this.ir === null) return new Float32Array(vertexSegment.length * 3);
    const perSeg = buildChunkColors(this.ir, chunk, this.colorMode);
    const colors = new Float32Array(vertexSegment.length * 3);
    for (let v = 0; v < vertexSegment.length; v++) {
      const s = vertexSegment[v] * 6;
      colors[v * 3] = perSeg[s];
      colors[v * 3 + 1] = perSeg[s + 1];
      colors[v * 3 + 2] = perSeg[s + 2];
    }
    return colors;
  }

  private makeChunkMesh(chunk: GeometryChunk): LineSegments | Mesh {
    if (this.active === 'tubes' && chunk.kind === 'extrude') {
      // Throws on budget overrun — caught by buildTick's fallback path.
      const tube = buildTubeChunk(this.ir as ToolpathIR, chunk, this.tubeOptions);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(tube.positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(tube.normals, 3));
      geometry.setAttribute('color', new BufferAttribute(this.tubeVertexColors(chunk, tube.vertexSegment), 3));
      geometry.setIndex(new BufferAttribute(tube.indices, 1));
      const mesh = new Mesh(geometry, this.makeExtrudeMaterial());
      mesh.userData.drawUnitsPerSegment = tube.indicesPerSegment;
      mesh.userData.vertexSegment = tube.vertexSegment;
      return mesh;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3));
    geometry.setAttribute(
      'color',
      new BufferAttribute(buildChunkColors(this.ir as ToolpathIR, chunk, this.colorMode), 3)
    );
    const mesh = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true }));
    mesh.userData.drawUnitsPerSegment = 2; // GL_LINES: 2 vertices per segment
    return mesh;
  }

  /** Upload a bounded amount of work, then reschedule (§5.3/§8). Public for tests. */
  buildTick(): void {
    if (this.disposed || this.ir === null || this.buildResult === null) return;
    // Count mode (explicit chunksPerTick — deterministic tests) or time-budget
    // mode (default): at least one chunk per tick, stopping once ~TICK_BUDGET_MS
    // of work has elapsed (§8: no >16 ms stall during incremental build).
    const tickStart = performance.now();
    let built = 0;
    while (this.pendingChunks.length > 0) {
      if (this.chunksPerTick !== undefined) {
        if (built >= this.chunksPerTick) break;
      } else if (built > 0 && performance.now() - tickStart >= TICK_BUDGET_MS) {
        break;
      }
      const chunk = this.pendingChunks.shift() as GeometryChunk;
      let mesh: LineSegments | Mesh;
      try {
        mesh = this.makeChunkMesh(chunk);
      } catch (err) {
        if (this.active === 'tubes') {
          this.fallbackToLines(err instanceof Error ? err.message : String(err));
        } else {
          this.emit({
            type: 'error',
            code: 'E_GEOMETRY_BUILD',
            message: err instanceof Error ? err.message : String(err)
          });
        }
        return;
      }
      mesh.name = `chunk:${chunk.kind}:${chunk.layerStart}-${chunk.layerEnd}`;
      mesh.userData.chunk = chunk;
      this.applyDrawStateToMesh(mesh, chunk); // honor clipping set during an in-flight build
      this.toolpathGroup.add(mesh);
      this.builtCount++;
      built++;
    }
    this.emit({ type: 'buildProgress', chunksBuilt: this.builtCount, chunksTotal: this.buildResult.chunks.length });
    this.render();
    if (this.pendingChunks.length > 0) {
      this.scheduleFrame(() => this.buildTick());
    } else {
      this.emit({
        type: 'buildComplete',
        segments: this.buildResult.totalSegmentsIncluded,
        decimationApplied: this.buildResult.decimationApplied,
        travelHidden: this.buildResult.travelHidden,
        quality: this.active
      });
    }
  }

  /** Synchronously finish all pending uploads (tests; also useful before capture). */
  flushBuild(): void {
    while (this.pendingChunks.length > 0 && !this.disposed) {
      this.buildTick();
    }
  }

  /** Number of layers in the retained IR (slider bounds for consumers). */
  get layerCount(): number {
    return this.ir?.layers.length ?? 0;
  }

  /** Number of IR segments (scrub-slider bounds for consumers). */
  get segmentCount(): number {
    return this.ir?.segments.count ?? 0;
  }

  /**
   * Pick the IR segment under a pointer, or null (#184 — click a segment → its G-code source line via
   * `sourceLineOfSegment` in `@chestnutlabs/toolpath-core`). `ndcX`/`ndcY` are normalized device coords (each in [-1, 1]); a
   * consumer converts a canvas click with `(x/w)*2-1`, `-(y/h)*2+1`. `threshold` is the world-space
   * line hit radius — auto-derived from the model size when omitted. Lines mode; tube meshes resolve
   * when they carry a vertex→segment table.
   */
  pickSegment(ndcX: number, ndcY: number, threshold?: number): number | null {
    if (this.chunkMeshes.length === 0) return null;
    this.pointer.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
    this.raycaster.params.Line.threshold = threshold ?? this.pickThreshold();
    for (const hit of this.raycaster.intersectObjects(this.chunkMeshes, false)) {
      if (hit.index === undefined) continue;
      const seg = resolveHitSegment(hit.object as LineSegments, hit.index);
      if (seg !== null) return seg;
    }
    return null;
  }

  /** Forgiving click radius (~0.5% of the model diagonal) that scales with model size. */
  private pickThreshold(): number {
    const b = this.ir?.bounds;
    if (b === undefined) return 0.5;
    return Math.max(0.2, 0.005 * Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z));
  }

  /**
   * Clip rendering to an inclusive layer range (§4.5). Draw-range trims on the
   * existing chunk geometry only — no rebuild, no new allocations.
   */
  setLayerRange(startLayer: number, endLayer: number): void {
    if (this.disposed) return;
    this.startLayer = Math.max(0, Math.floor(startLayer));
    this.endLayer = Math.floor(endLayer);
    this.applyDrawState();
    this.render();
  }

  /**
   * Scrub: render only segments with IR index <= segIndex (within the layer
   * range). `null` clears the scrub cut.
   */
  setScrubPosition(segIndex: number | null): void {
    if (this.disposed) return;
    this.scrubSegIndex = segIndex === null ? null : Math.max(-1, Math.floor(segIndex));
    this.applyDrawState();
    this.render();
  }

  /**
   * Opt-in retraction/deretraction markers (DD-009 D1, #148). Points at each
   * retract (warm) / unretract (cool) event; clipped by the same layer/scrub
   * window as the toolpath. Capability-honest: no markers when the IR carries no
   * retraction events (`capabilities.retractions !== 'known'`).
   */
  setShowRetractions(visible: boolean): void {
    if (this.disposed) return;
    this.showRetractions = visible;
    this.updateRetractionMarkers();
    this.render();
  }

  /** True when the current IR actually carries positioned retraction events. */
  get hasRetractions(): boolean {
    return this.ir?.header.capabilities['retractions'] === 'known';
  }

  private buildRetractionMarkers(): void {
    if (this.retractionPoints !== null) {
      this.toolpathGroup.remove(this.retractionPoints);
      (this.retractionPoints.geometry as BufferGeometry).dispose();
      this.retractionPoints = null;
    }
    this.retractionSegIndices = new Uint32Array(0);
    const events = this.ir?.retractions ?? [];
    if (events.length === 0) return;
    const positions = new Float32Array(events.length * 3);
    const colors = new Float32Array(events.length * 3);
    const segIdx = new Uint32Array(events.length);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      // Raw printer coords — the scene root's rotation handles Z-up→Y-up, like all
      // other geometry under toolpathGroup (cf. updateMarker).
      positions[i * 3] = e.x;
      positions[i * 3 + 1] = e.y;
      positions[i * 3 + 2] = e.z;
      // retract = warm (0xff6d00), unretract = cool (0x00b8d4)
      const warm = e.kind === 'retract';
      colors[i * 3] = warm ? 1.0 : 0.0;
      colors[i * 3 + 1] = warm ? 0.43 : 0.72;
      colors[i * 3 + 2] = warm ? 0.0 : 0.83;
      segIdx[i] = e.segIndex;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    const points = new Points(geometry, this.retractionMaterial);
    points.renderOrder = 11; // above the progress marker (10) and ghost
    points.frustumCulled = false;
    this.retractionSegIndices = segIdx;
    this.retractionPoints = points;
    this.toolpathGroup.add(points);
  }

  private updateRetractionMarkers(): void {
    const points = this.retractionPoints;
    if (points === null) return;
    if (!this.showRetractions || !this.hasRetractions) {
      points.visible = false;
      return;
    }
    points.visible = true;
    // Clip to the current visible segment window (events are recorded in segIndex order).
    const win = this.visibleSegWindow();
    const idx = this.retractionSegIndices;
    let start = 0;
    while (start < idx.length && idx[start] < win.lo) start++;
    let end = start;
    while (end < idx.length && idx[end] <= win.hi) end++;
    (points.geometry as BufferGeometry).setDrawRange(start, Math.max(0, end - start));
  }

  /** The [lo, hi] segment-index window currently drawn, from layer range + scrub. */
  private visibleSegWindow(): { lo: number; hi: number } {
    const ir = this.ir;
    if (ir === null || ir.layers.length === 0) return { lo: 0, hi: Infinity };
    const last = ir.layers.length - 1;
    const start = Math.min(Math.max(0, this.startLayer), last);
    const end = Math.min(Math.max(start, this.endLayer === Infinity ? last : this.endLayer), last);
    const lo = ir.layers[start].segStart;
    let hi = ir.layers[end].segEnd;
    if (this.scrubSegIndex !== null) hi = Math.min(hi, this.scrubSegIndex);
    return { lo, hi };
  }

  /** Toggle a move kind (extrusion/travel) on or off (whole-chunk visibility, §4.3). */
  setKindVisible(kind: GeometryChunk['kind'], visible: boolean): void {
    if (this.disposed) return;
    this.kindVisible[kind] = visible;
    this.applyDrawState();
    this.render();
  }

  /**
   * Capability gate (§4.6): feature coloring needs the IR to actually carry
   * feature roles — `featureRoles: 'unavailable'` means the UI must disable it,
   * not render fabricated colors. Single/tool modes are always available.
   */
  isColorModeAvailable(mode: ColorMode['mode']): boolean {
    if (mode === 'feature') {
      const conf = this.ir?.header.capabilities['featureRoles'];
      return conf !== undefined && conf !== 'unavailable';
    }
    if (mode === 'colorChange') {
      const conf = this.ir?.header.capabilities['colorChanges'];
      return conf !== undefined && conf !== 'unavailable';
    }
    if (mode === 'object') {
      // Color-by-object needs the object channel populated (#178) — M486/EXCLUDE_OBJECT files.
      const conf = this.ir?.header.capabilities['objects'];
      return conf !== undefined && conf !== 'unavailable';
    }
    if (mode === 'feedrate') {
      // Color-by-speed needs known feedrates (#177) — always populated by the parser, but honor a
      // consumer/adapter that reports it unavailable rather than fabricating a speed heatmap.
      const conf = this.ir?.header.capabilities['feedrate'];
      return conf !== 'unavailable';
    }
    if (mode === 'layerHeight') {
      // Color-by-layer-height needs a real planar layer table (#179); a non-planar/CNC IR
      // (`layers: 'unavailable'`) collapses every segment to one layer, so the mode is not meaningful.
      const conf = this.ir?.header.capabilities['layers'];
      return conf !== undefined && conf !== 'unavailable';
    }
    if (mode === 'power') {
      // Color-by-power needs the `toolPower` modal channel captured (#189) — present only when the parse
      // requested it and a tool-state was seen (or a CNC dialect reported it). Absent → not available.
      const conf = this.ir?.header.capabilities['toolPower'];
      return conf !== undefined && conf !== 'unavailable';
    }
    // 'moveKind' (cut-vs-rapid) reads the always-present kind channel → always available, like single/tool.
    return true;
  }

  /** True when the current IR carries M600 color-change boundaries (#147, DD-009 D2). */
  get hasColorChanges(): boolean {
    return this.ir?.header.capabilities['colorChanges'] === 'known';
  }

  private applyDrawState(): void {
    // No ir-null guard: preview meshes (which exist before any final IR) still
    // honor kind visibility; the per-mesh path guards the IR-dependent work.
    for (const mesh of this.chunkMeshes) {
      const chunk = mesh.userData.chunk as GeometryChunk | undefined;
      if (chunk) this.applyDrawStateToMesh(mesh, chunk);
    }
    this.updateMarker();
    this.updateRetractionMarkers();
  }

  /**
   * The overlay's completed/ghost cut segment indices, or null when the overlay is hidden.
   * The completed cut sits at the band's lower edge, the ghost starts after its upper edge
   * (DD-006 §4.5); a point position (`known`) collapses the band to nothing.
   */
  private overlayCuts(): { lo: number; hi: number } | null {
    if (this.presentationMode === 'hidden' || this.progress === null) return null;
    const p = this.progress;
    const lo = p.band !== null ? p.band[0] - 1 : (p.segIndex ?? -1);
    const hi = p.band !== null ? p.band[1] : (p.segIndex ?? -1);
    // A point band ([s, s]) means exact: completed through s, no emphasis segments.
    if (p.band !== null && p.band[0] === p.band[1]) return { lo: p.band[0], hi: p.band[1] };
    return { lo, hi };
  }

  private applyDrawStateToMesh(mesh: LineSegments | Mesh, chunk: GeometryChunk): void {
    if (mesh.userData.preview === true) {
      // Preview meshes: slice-local indices — kind visibility only, no clipping.
      mesh.visible = this.kindVisible[chunk.kind];
      return;
    }
    if (this.ir === null) return;
    if (!this.kindVisible[chunk.kind]) {
      mesh.visible = false;
      this.setOverlayMeshes(mesh, chunk, null, false);
      return;
    }
    // User scrub always wins the cut (D5); otherwise the overlay's completed cut applies.
    const scrubActive = this.scrubSegIndex !== null;
    const overlay = this.overlayCuts();
    const upper = scrubActive ? (this.scrubSegIndex as number) : overlay !== null ? overlay.lo : undefined;
    const state = computeDrawState(this.ir, chunk, this.startLayer, this.endLayer, upper);
    mesh.visible = state.visible;
    // Segment-uniform draw units (§4.5, identical contract in both quality modes):
    // lines = 2 vertices/segment; tubes = indicesPerSegment indices/segment.
    const units = (mesh.userData.drawUnitsPerSegment as number | undefined) ?? 2;
    (mesh.geometry as BufferGeometry).setDrawRange(state.drawStart * units, state.drawCount * units);
    this.setOverlayMeshes(mesh, chunk, overlay, scrubActive);
  }

  /**
   * Maintain the per-chunk ghost/band overlay passes (DD-006 §4.5). Both are LineSegments
   * over the chunk's LINE positions — in tubes mode this *is* the required line-style ghost
   * (§8), and no geometry is duplicated in lines mode (the position attribute is shared).
   * During user scrub the ghost is dropped (scrub owns the cut) but the band emphasis stays.
   */
  private setOverlayMeshes(
    mesh: LineSegments | Mesh,
    chunk: GeometryChunk,
    overlay: { lo: number; hi: number } | null,
    scrubActive: boolean
  ): void {
    let ghost = mesh.userData.overlayGhost as LineSegments | undefined;
    let band = mesh.userData.overlayBand as LineSegments | undefined;
    if (overlay === null) {
      if (ghost !== undefined) ghost.visible = false;
      if (band !== undefined) band.visible = false;
      return;
    }
    if (ghost === undefined) {
      // Lazy warm-up on the first live observation. Lines mode shares the main mesh's
      // position attribute; tubes mode wraps the chunk's (retained) line positions.
      const mainIsLines = (mesh.userData.drawUnitsPerSegment as number | undefined) === 2;
      const position = mainIsLines
        ? ((mesh.geometry as BufferGeometry).getAttribute('position') as BufferAttribute)
        : new BufferAttribute(chunk.positions, 3);
      const makePass = (material: LineBasicMaterial, name: string): LineSegments => {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', position);
        const pass = new LineSegments(geometry, material);
        pass.name = `${name}:${chunk.kind}:${chunk.layerStart}-${chunk.layerEnd}`;
        pass.userData.overlayFor = mesh;
        this.toolpathGroup.add(pass);
        return pass;
      };
      ghost = makePass(this.ghostMaterial, 'overlay-ghost');
      band = makePass(this.bandMaterial, 'overlay-band');
      mesh.userData.overlayGhost = ghost;
      mesh.userData.overlayBand = band;
    }
    const states = computeOverlayDrawStates(
      this.ir as ToolpathIR,
      chunk,
      this.startLayer,
      this.endLayer,
      overlay.lo,
      overlay.hi
    );
    ghost.visible = !scrubActive && states.ghost.visible;
    (ghost.geometry as BufferGeometry).setDrawRange(states.ghost.drawStart * 2, states.ghost.drawCount * 2);
    (band as LineSegments).visible = states.band.visible;
    (band as LineSegments).material = this.presentationMode === 'stale' ? this.staleBandMaterial : this.bandMaterial;
    ((band as LineSegments).geometry as BufferGeometry).setDrawRange(
      states.band.drawStart * 2,
      states.band.drawCount * 2
    );
  }

  /** Position marker: shown only for `known` positions — a point for an approximate tier
   *  would be false precision (DD-006 §4.5); approximate tiers get the band instead. */
  private updateMarker(): void {
    const p = this.progress;
    const show =
      this.ir !== null &&
      this.presentationMode !== 'hidden' &&
      p !== null &&
      p.confidence === 'known' &&
      p.segIndex !== null;
    if (!show) {
      if (this.markerMesh !== null) this.markerMesh.visible = false;
      return;
    }
    if (this.markerMesh === null) {
      this.markerMesh = new Mesh(new SphereGeometry(1.5, 16, 12), this.markerMaterial);
      this.markerMesh.name = 'overlay-marker';
      this.markerMesh.userData.overlayMarker = true;
      this.markerMesh.renderOrder = 10; // after the toolpath — depthTest is off
      this.toolpathGroup.add(this.markerMesh);
    }
    const ir = this.ir as ToolpathIR;
    // Model-relative size (fixed mm vanish on large models / small canvases), clamped sane.
    const b = ir.bounds;
    if (Number.isFinite(b.min.x)) {
      const modelRadius = Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) / 2;
      this.markerMesh.scale.setScalar(Math.max(1.5, Math.min(5, modelRadius * 0.035)) / 1.5);
    }
    const seg = (p as MappedProgress).segIndex as number;
    this.markerMesh.position.set(ir.segments.x1[seg], ir.segments.y1[seg], ir.segments.z1[seg]);
    this.markerMesh.material = this.presentationMode === 'stale' ? this.staleMarkerMaterial : this.markerMaterial;
    this.markerMesh.visible = true;
  }

  /**
   * Live-progress overlay input (DD-006 §4.5): a `MappedProgress` from the core mapper, or
   * null to hide the overlay entirely. Presentation is decided by confidence — exact gets a
   * marker, approximate gets an uncertainty band, stale grays out, unavailable hides — and
   * every mode change emits `progress-presentation-changed`.
   */
  setProgress(p: MappedProgress | null): void {
    if (this.disposed) return;
    this.progress = p;
    let mode: ProgressPresentationMode;
    let reason: string | undefined;
    if (p === null || p.confidence === 'unavailable') {
      mode = 'hidden';
      reason = p?.notes[0]?.code;
    } else if (p.stale) {
      mode = 'stale';
      reason = 'observation-stale';
    } else {
      mode = p.confidence === 'known' ? 'exact' : 'band';
    }
    if (mode !== this.presentationMode) {
      this.presentationMode = mode;
      this.emit(
        reason === undefined
          ? { type: 'progress-presentation-changed', mode }
          : { type: 'progress-presentation-changed', mode, reason }
      );
    }
    this.applyDrawState();
    this.render();
  }

  /** Current overlay presentation (DD-006 §4.5) — mirrors the last emitted mode. */
  get progressPresentation(): ProgressPresentationMode {
    return this.presentationMode;
  }

  /**
   * Size both projections from the tracked aspect + framed half-height (#150).
   * Perspective keeps a fixed vertical fov and only consumes the aspect; ortho
   * keeps the vertical extent fixed and widens horizontally by aspect — so neither
   * a resize nor a projection toggle stretches or rescales the model.
   */
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

  /**
   * Switch the camera projection (#150, DD-009 D3). The pose (position/orientation)
   * is copied to the incoming camera so the view never jumps, OrbitControls is
   * reattached to it, and its frustum is re-sized before the next render.
   */
  setCameraMode(mode: CameraMode): void {
    if (this.disposed || mode === this.cameraModeState) return;
    const prev = this.activeCamera;
    const next = mode === 'orthographic' ? this.orthographicCamera : this.perspectiveCamera;
    next.position.copy(prev.position);
    next.quaternion.copy(prev.quaternion);
    next.up.copy(prev.up);
    this.cameraModeState = mode;
    this.activeCamera = next;
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

  /** Screen-up for a view direction. World-up (0,1,0) is degenerate when looking straight up/down it,
   *  so top/bottom roll about scene −Z instead. Reproduces every preset's up *and* keeps setCameraState
   *  round-trips deterministic (the state contract carries no explicit up). */
  private upForViewDir(dir: Vector3): Vector3 {
    return Math.abs(dir.y) > 0.999 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  }

  /**
   * Snap to a preset orientation (#268): place the camera on the view's unit direction from the
   * current target, at the current distance, and look at the target. Instant (no animation);
   * preserves the active `cameraMode`. A no-op on a disposed renderer.
   */
  setView(view: CameraView): void {
    if (this.disposed) return;
    const dir = new Vector3(...VIEW_DIRECTIONS[view]).normalize();
    const target = this.currentTarget();
    // Keep the current dolly distance; fall back to the framed distance if the camera sits on target.
    const distance = this.activeCamera.position.distanceTo(target) || this.viewHalfHeight * 2.15;
    this.activeCamera.up.copy(this.upForViewDir(dir));
    this.activeCamera.position.copy(target).addScaledVector(dir, distance);
    this.activeCamera.lookAt(target);
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
    const p = this.activeCamera.position;
    return {
      position: { x: p.x, y: p.y, z: p.z },
      target: { x: t.x, y: t.y, z: t.z },
      zoom: this.activeCamera.zoom,
      cameraMode: this.cameraModeState
    };
  }

  /**
   * Restore a {@link CameraState} verbatim (#268) — position/target/zoom/mode as given, with no
   * re-fit to the current model's bounds. Instant. A no-op on a disposed renderer.
   */
  setCameraState(state: CameraState): void {
    if (this.disposed) return;
    this.setCameraMode(state.cameraMode); // no-op if unchanged; activates the right camera otherwise
    const cam = this.activeCamera;
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

  /** Fit the camera to the toolpath bounds (falls back to the build volume). */
  frame(): void {
    if (this.disposed) return;
    const b = this.ir && Number.isFinite(this.ir.bounds.min.x) ? this.ir.bounds : null;
    const center = new Vector3();
    let radius = 100;
    if (b) {
      center.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      radius = Math.max(10, center.distanceTo(new Vector3(b.min.x, b.min.y, b.min.z)));
    } else if (this.previewBounds !== null) {
      // Progressive preview: frame what has streamed in so far.
      const p = this.previewBounds;
      center.set((p.min.x + p.max.x) / 2, (p.min.y + p.max.y) / 2, (p.min.z + p.max.z) / 2);
      radius = Math.max(10, center.distanceTo(p.min));
    } else if (this.volumeDef) {
      // No toolpath yet: the bed is corner-origin, so its center is (x/2, y/2).
      center.set(this.volumeDef.x / 2, this.volumeDef.y / 2, 0);
      radius = Math.max(10, Math.max(this.volumeDef.x, this.volumeDef.y) * 0.75);
    }
    // Printer coords → scene coords through the root rotation (x, z, -y).
    const target = new Vector3(center.x, center.z, -center.y);
    // The perspective offset magnitude is ≈2.69·radius at fov 50°, so the visible
    // half-height at the target plane is ≈2.69·radius·tan(25°) ≈ 1.25·radius; the
    // ortho frustum uses the same half-height so toggling projection keeps the
    // model the same apparent size (#150).
    this.viewHalfHeight = radius * 1.25;
    this.framedTarget.copy(target);
    this.activeCamera.position.set(target.x - radius * 1.2, target.y + radius * 1.6, target.z + radius * 1.8);
    this.activeCamera.lookAt(target);
    this.updateCameraProjection();
    if (this.controls) {
      this.controls.target.copy(target);
      // Bound zoom to the framed model so the user can't dolly through it or lose it at the extremes
      // (#267). Recomputed here, not just at construction, because `radius` changes per file. The
      // default framed distance is ≈2.69·radius, so this keeps a wide but finite range around it.
      this.controls.minDistance = Math.max(1, radius * 0.15);
      this.controls.maxDistance = radius * 30;
      this.controls.update();
    }
    this.render();
  }

  /**
   * Switch color mode (attribute rewrite, no geometry rebuild — §4.6). Returns
   * false (and emits an error event) when the mode is capability-gated off.
   */
  setColorMode(mode: ColorMode): boolean {
    if (!this.isColorModeAvailable(mode.mode)) {
      this.emit({
        type: 'error',
        code: 'E_COLOR_MODE_UNAVAILABLE',
        message: `color mode '${mode.mode}' is unavailable: the IR does not carry the required capability ('unavailable' or missing)`
      });
      return false;
    }
    this.colorMode = mode;
    if (this.ir === null) return true;
    // Recolor = attribute rewrite, no geometry rebuild (§4.6) — both quality modes.
    for (const mesh of this.chunkMeshes) {
      const chunk = mesh.userData.chunk as GeometryChunk | undefined;
      if (!chunk) continue;
      const vertexSegment = mesh.userData.vertexSegment as Uint32Array | undefined;
      const colors = vertexSegment
        ? this.tubeVertexColors(chunk, vertexSegment)
        : buildChunkColors(this.ir, chunk, mode);
      (mesh.geometry as BufferGeometry).setAttribute('color', new BufferAttribute(colors, 3));
    }
    this.render();
    return true;
  }

  /** Extrude (tube) material for the current theme preset (#153). Lines geometry is unlit. */
  private makeExtrudeMaterial(): MeshLambertMaterial | MeshStandardMaterial {
    return this.resolvedTheme.materialPreset === 'glossy'
      ? new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1 })
      : new MeshLambertMaterial({ vertexColors: true });
  }

  /** Grid/box styling for the build volume from the current theme (#153). */
  private volumeStyle(): BuildVolumeStyle {
    const t = this.resolvedTheme;
    return {
      gridColor: t.gridColor,
      gridOpacity: t.gridOpacity,
      boxColor: t.bedColor,
      boxOpacity: t.bedOpacity,
      bedSurface: t.bedSurface
    };
  }

  /** Set (or clear) the scene background from the theme. Null leaves three's default. */
  private applyBackground(): void {
    const bg = this.resolvedTheme.background;
    this.scene.background = bg === null ? null : new Color(bg as string | number);
  }

  /**
   * Apply a bounded declarative theme (#153, DD-009 D4), replacing the current one:
   * unspecified fields reset to {@link DEFAULT_THEME}. Restyles lights, background,
   * the build-volume grid/box, and swaps the extrude (tube) material preset live —
   * disposing replaced materials/geometry. Lines geometry and the semantic marker/
   * overlay/origin colors are unaffected.
   */
  setTheme(theme: Theme): void {
    if (this.disposed) return;
    const prevPreset = this.resolvedTheme.materialPreset;
    this.resolvedTheme = resolveTheme(theme);
    const t = this.resolvedTheme;
    this.hemiLight.color.set(t.hemisphereSky as string | number);
    this.hemiLight.groundColor.set(t.hemisphereGround as string | number);
    this.hemiLight.intensity = t.hemisphereIntensity;
    this.dirLight.color.set(t.directionalColor as string | number);
    this.dirLight.intensity = t.directionalIntensity;
    this.applyBackground();
    // Rebuild the build volume with the new grid/box styling (reuses the dispose walk).
    if (this.volumeDef !== null && this.volumeGroup !== null) {
      this.volumeGroup.traverse((obj) => {
        const mesh = obj as LineSegments;
        (mesh.geometry as BufferGeometry | undefined)?.dispose?.();
        (mesh.material as LineBasicMaterial | undefined)?.dispose?.();
      });
      this.root.remove(this.volumeGroup);
      this.volumeGroup = createBuildVolume(this.volumeDef, this.volumeStyle());
      this.root.add(this.volumeGroup);
    }
    // Swap the tube material preset only when it actually changed (avoids churn/leaks).
    if (t.materialPreset !== prevPreset) {
      for (const mesh of this.chunkMeshes) {
        if (mesh.userData.vertexSegment === undefined) continue; // lines mesh: unaffected
        const old = (mesh as Mesh).material as MeshLambertMaterial | MeshStandardMaterial | undefined;
        (mesh as Mesh).material = this.makeExtrudeMaterial();
        old?.dispose();
      }
    }
    this.render();
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.aspect = width / Math.max(1, height);
    this.updateCameraProjection();
    this.gl.setSize(width, height, false);
    this.render();
  }

  render(): void {
    if (this.disposed || this.contextLost) return;
    this.gl.render(this.scene, this.activeCamera);
  }

  /**
   * Apply a build volume after construction (DD-005 §4.2 amendment: parse →
   * discover machine geometry → apply, no renderer reconstruction). Accepts a
   * plain BuildVolumeDef or a discovered MachineGeometry (circular/polygon beds
   * render as their bounding volume in v1). Emits `machine-geometry-mismatch`
   * when a consumer-configured volume disagrees with a discovered one by >1 mm.
   */
  setBuildVolume(def: BuildVolumeDef | MachineGeometry): void {
    if (this.disposed) return;
    const next = 'bed' in def ? machineToVolume(def) : def;
    if (this.volumeDef !== null && 'bed' in def) {
      const dx = Math.abs(this.volumeDef.x - next.x);
      const dy = Math.abs(this.volumeDef.y - next.y);
      if (dx > 1 || dy > 1) {
        this.emit({
          type: 'error',
          code: 'machine-geometry-mismatch',
          message:
            `file-discovered bed ${next.x}×${next.y} differs from the configured ` +
            `${this.volumeDef.x}×${this.volumeDef.y} — this file may target a different printer`
        });
      }
    }
    if (this.volumeGroup !== null) {
      this.volumeGroup.traverse((obj) => {
        const mesh = obj as LineSegments;
        (mesh.geometry as BufferGeometry | undefined)?.dispose?.();
        (mesh.material as LineBasicMaterial | undefined)?.dispose?.();
      });
      this.root.remove(this.volumeGroup);
    }
    this.volumeDef = next;
    this.volumeGroup = createBuildVolume(next, this.volumeStyle());
    this.root.add(this.volumeGroup);
    this.render();
  }

  /** The quality tier actually built (may differ from requested via auto/fallback). */
  get activeQuality(): QualityMode {
    return this.active;
  }

  /** Change the quality tier; rebuilds from the retained IR when one is set. */
  setQuality(quality: QualityMode | 'auto'): void {
    if (this.disposed) return;
    this.requestedQuality = quality;
    if (this.ir !== null) {
      this.startBuild(this.ir);
      this.render();
    }
  }

  /** Currently built chunk meshes: LineSegments (lines/travel) or Mesh (tubes). */
  get chunkMeshes(): (LineSegments | Mesh)[] {
    return this.toolpathGroup.children.filter(
      (c): c is LineSegments | Mesh => (c as LineSegments | Mesh).userData?.chunk !== undefined
    );
  }

  private clearToolpathGeometry(): void {
    for (const child of [...this.toolpathGroup.children]) {
      // The retraction marker layer (#148) owns its own lifecycle (rebuilt per IR);
      // it is not chunk geometry, so leave it alone here.
      if (child === this.retractionPoints) continue;
      const mesh = child as LineSegments;
      (mesh.geometry as BufferGeometry | undefined)?.dispose();
      const material = mesh.material as LineBasicMaterial | LineBasicMaterial[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
      this.toolpathGroup.remove(child);
    }
    this.pendingChunks = [];
    this.builtCount = 0;
    this.previewSegments = 0;
    this.previewBounds = null;
    this.markerMesh = null; // its geometry was disposed with the group children above
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.clearToolpathGeometry();
    if (this.volumeGroup) {
      this.volumeGroup.traverse((obj) => {
        const mesh = obj as LineSegments;
        (mesh.geometry as BufferGeometry | undefined)?.dispose?.();
        (mesh.material as LineBasicMaterial | undefined)?.dispose?.();
      });
    }
    this.ghostMaterial.dispose();
    this.bandMaterial.dispose();
    this.staleBandMaterial.dispose();
    this.markerMaterial.dispose();
    this.staleMarkerMaterial.dispose();
    (this.retractionPoints?.geometry as BufferGeometry | undefined)?.dispose();
    this.retractionMaterial.dispose();
    this.controls?.dispose();
    this.gl.dispose();
    this.listeners.clear();
    this.ir = null;
  }
}
