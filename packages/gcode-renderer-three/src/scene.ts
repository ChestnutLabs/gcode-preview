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
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ToolpathIR } from '@chestnutlabs/toolpath-core';
import { buildChunks, type ChunkBuildResult, type GeometryChunk } from './chunks.js';
import { buildChunkColors, type ColorMode } from './colors.js';
import { computeDrawState } from './ranges.js';
import { createBuildVolume, type BuildVolumeDef } from './build-volume.js';

export type RendererEvent =
  | { type: 'buildProgress'; chunksBuilt: number; chunksTotal: number }
  | { type: 'buildComplete'; segments: number; decimationApplied: number; travelHidden: boolean }
  | { type: 'contextlost' }
  | { type: 'restored' }
  | { type: 'error'; code: string; message: string };

/** Minimal surface of WebGLRenderer the scene layer uses — injectable for tests. */
export interface GLRendererLike {
  render(scene: Scene, camera: PerspectiveCamera): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio?(ratio: number): void;
  dispose(): void;
  domElement: HTMLCanvasElement;
}

export interface ToolpathRendererOptions {
  canvas: HTMLCanvasElement;
  buildVolume?: BuildVolumeDef;
  /** Chunks uploaded per scheduler tick (bounded work per frame, §5.3). Default 4. */
  chunksPerTick?: number;
  colorMode?: ColorMode;
  /** Injectables for tests / exotic hosts. */
  createRenderer?: (canvas: HTMLCanvasElement) => GLRendererLike;
  scheduleFrame?: (cb: () => void) => void;
}

const DEFAULT_COLOR: ColorMode = { mode: 'single', color: [0.9, 0.4, 0.7] };

export class ToolpathRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: GLRendererLike;
  private readonly scheduleFrame: (cb: () => void) => void;
  private readonly chunksPerTick: number;

  private readonly scene = new Scene();
  private readonly root = new Group();
  private readonly toolpathGroup = new Group();
  private volumeGroup: Group | null = null;
  readonly camera: PerspectiveCamera;
  private controls: OrbitControls | null = null;

  private ir: ToolpathIR | null = null;
  private buildResult: ChunkBuildResult | null = null;
  private pendingChunks: GeometryChunk[] = [];
  private builtCount = 0;
  private colorMode: ColorMode;
  // Clipping state (§4.5): draw-range trims only — geometry is never rebuilt here.
  private startLayer = 0;
  private endLayer = Infinity;
  private scrubSegIndex: number | null = null;
  private kindVisible: Record<GeometryChunk['kind'], boolean> = { extrude: true, travel: true };
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
    this.chunksPerTick = opts.chunksPerTick ?? 4;
    this.colorMode = opts.colorMode ?? DEFAULT_COLOR;
    this.scheduleFrame =
      opts.scheduleFrame ??
      ((cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => cb()) : setTimeout(cb, 16)));
    this.gl = (opts.createRenderer ?? ((canvas) => new WebGLRenderer({ canvas, antialias: true })))(opts.canvas);

    // Single Z-up→Y-up conversion (§6.2); everything below is printer coordinates.
    this.root.rotation.x = -Math.PI / 2;
    this.scene.add(this.root);
    this.root.add(this.toolpathGroup);
    if (opts.buildVolume) {
      this.volumeGroup = createBuildVolume(opts.buildVolume);
      this.root.add(this.volumeGroup);
    }

    this.camera = new PerspectiveCamera(50, 1, 0.1, 10000);
    this.camera.position.set(-100, 200, 250);
    try {
      this.controls = new OrbitControls(this.camera, this.gl.domElement);
      this.controls.addEventListener('change', () => this.render());
    } catch {
      this.controls = null; // headless hosts without full DOM events
    }

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  onEvent(cb: (e: RendererEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: RendererEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  /** Retain the IR and (re)build the scene from it incrementally. */
  setIR(ir: ToolpathIR): void {
    if (this.disposed) return;
    this.ir = ir;
    // Layer/segment counts belong to the old IR — reset clipping to "show everything".
    this.startLayer = 0;
    this.endLayer = Infinity;
    this.scrubSegIndex = null;
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
    this.pendingChunks = [...this.buildResult.chunks];
    this.builtCount = 0;
    this.scheduleFrame(() => this.buildTick());
  }

  /** Upload a bounded number of chunks, then reschedule (§5.3). Public for tests. */
  buildTick(): void {
    if (this.disposed || this.ir === null || this.buildResult === null) return;
    const batch = this.pendingChunks.splice(0, this.chunksPerTick);
    for (const chunk of batch) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(chunk.positions, 3));
      geometry.setAttribute('color', new BufferAttribute(buildChunkColors(this.ir, chunk, this.colorMode), 3));
      const material = new LineBasicMaterial({ vertexColors: true });
      const mesh = new LineSegments(geometry, material);
      mesh.name = `chunk:${chunk.kind}:${chunk.layerStart}-${chunk.layerEnd}`;
      mesh.userData.chunk = chunk;
      this.applyDrawStateToMesh(mesh, chunk); // honor clipping set during an in-flight build
      this.toolpathGroup.add(mesh);
      this.builtCount++;
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
        travelHidden: this.buildResult.travelHidden
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
    if (mode !== 'feature') return true;
    const conf = this.ir?.header.capabilities['featureRoles'];
    return conf !== undefined && conf !== 'unavailable';
  }

  private applyDrawState(): void {
    if (this.ir === null) return;
    for (const mesh of this.chunkMeshes) {
      const chunk = mesh.userData.chunk as GeometryChunk | undefined;
      if (chunk) this.applyDrawStateToMesh(mesh, chunk);
    }
  }

  private applyDrawStateToMesh(mesh: LineSegments, chunk: GeometryChunk): void {
    if (this.ir === null) return;
    if (!this.kindVisible[chunk.kind]) {
      mesh.visible = false;
      return;
    }
    const state = computeDrawState(this.ir, chunk, this.startLayer, this.endLayer, this.scrubSegIndex ?? undefined);
    mesh.visible = state.visible;
    // GL_LINES: 2 vertices per segment; drawRange is in vertices for non-indexed geometry.
    (mesh.geometry as BufferGeometry).setDrawRange(state.drawStart * 2, state.drawCount * 2);
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
    }
    // Printer coords → scene coords through the root rotation (x, z, -y).
    const target = new Vector3(center.x, center.z, -center.y);
    this.camera.position.set(target.x - radius * 1.2, target.y + radius * 1.6, target.z + radius * 1.8);
    this.camera.lookAt(target);
    if (this.controls) {
      this.controls.target.copy(target);
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
        message: `color mode '${mode.mode}' is unavailable: IR capability featureRoles is missing or 'unavailable'`
      });
      return false;
    }
    this.colorMode = mode;
    if (this.ir === null) return true;
    // Recolor = attribute rewrite, no geometry rebuild (§4.6).
    for (const child of this.toolpathGroup.children) {
      const mesh = child as LineSegments;
      const chunk = mesh.userData.chunk as GeometryChunk | undefined;
      if (!chunk) continue;
      (mesh.geometry as BufferGeometry).setAttribute(
        'color',
        new BufferAttribute(buildChunkColors(this.ir, chunk, mode), 3)
      );
    }
    this.render();
    return true;
  }

  resize(width: number, height: number): void {
    if (this.disposed) return;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.gl.setSize(width, height, false);
    this.render();
  }

  render(): void {
    if (this.disposed || this.contextLost) return;
    this.gl.render(this.scene, this.camera);
  }

  /** Currently built chunk meshes (stable API for phase 3's draw-range work). */
  get chunkMeshes(): LineSegments[] {
    return this.toolpathGroup.children.filter((c): c is LineSegments => c instanceof LineSegments);
  }

  private clearToolpathGeometry(): void {
    for (const child of [...this.toolpathGroup.children]) {
      const mesh = child as LineSegments;
      (mesh.geometry as BufferGeometry | undefined)?.dispose();
      const material = mesh.material as LineBasicMaterial | LineBasicMaterial[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
      this.toolpathGroup.remove(child);
    }
    this.pendingChunks = [];
    this.builtCount = 0;
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
    this.controls?.dispose();
    this.gl.dispose();
    this.listeners.clear();
    this.ir = null;
  }
}
