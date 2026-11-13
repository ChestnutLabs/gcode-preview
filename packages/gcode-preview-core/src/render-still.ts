/**
 * renderStill — headless, non-interactive still image of a toolpath (DD-008 §4.8,
 * E7 phase 5, issue #132; consumer: AnyBridge #791 ThumbnailWorker).
 *
 * A bounded adapter over the SAME engine the interactive controller uses: parse
 * (worker, for bytes) or accept a pre-parsed `ToolpathIR`, build the geometry to
 * completion, frame the camera deterministically (or apply an explicit pose),
 * render exactly once, and hand back the canvas + build stats. The caller
 * extracts pixels in its own environment (`OffscreenCanvas.convertToBlob`,
 * `canvas.toDataURL`, or a WebGL `readPixels`) — this module never touches the
 * filesystem, a DOM, or a worker it wasn't given.
 *
 * Supported environments (see docs/reference/still-render.md): any Chromium-class
 * WebGL2 context — an Electron hidden window, a Worker `OffscreenCanvas`, or
 * headless Chromium. Pure-Node GPU-less rendering is out of scope (deferred
 * E8-class roadmap item).
 *
 * Determinism: same environment ⇒ identical output. Cross-GPU/driver pixel
 * identity is NOT promised (antialiasing varies); cache by job identity.
 */
import { GcodeParseSession, type SessionOptions, type WireParseOptions } from '@chestnutlabs/gcode-parser';
// Type-only: the renderer itself is loaded with `await import()` inside renderStill, so this module
// adds no static value import of the main entry (a 2D-only bundle must not ship three.js; see `./lite`).
import type {
  BuildVolumeDef,
  CameraMode,
  ColorMode,
  GeometryWorkerLike,
  GLRendererLike,
  QualityMode,
  QualityPolicy,
  RenderTargetCanvas,
  Theme,
  ThemeColor,
  TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import { type MachineGeometry, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { checkCameraFov } from './lens.js';

/** Explicit camera pose (scene coordinates), overriding the deterministic frame(). */
export interface StillCameraPose {
  position: [number, number, number];
  target: [number, number, number];
  /** Vertical field of view in degrees (default: {@link RenderStillOptions.cameraFov}, else 50°). Beats `cameraFov`. */
  fov?: number;
}

export interface RenderStillOptions {
  /** Target surface: an OffscreenCanvas (worker/headless) or a DOM canvas. Required. */
  canvas: RenderTargetCanvas;
  /** Output size. Defaults to the canvas's current width/height. Must be finite and greater than 0, else `RangeError`. */
  width?: number;
  height?: number;
  /** Quality tier (default 'auto': tubes ≤ 1 M segments, else lines). */
  quality?: QualityMode | 'auto';
  /** Camera projection (#150, DD-009 D3); default 'perspective'. */
  cameraMode?: CameraMode;
  /**
   * Perspective lens, vertical field of view in degrees (DD-032 §4.2); default 50. The deterministic
   * framing reads it, so the framed content fits at any lens; an explicit `camera.fov` beats it. Must be
   * in [10, 120]: anything else rejects with `RangeError` before any parse or GL work.
   */
  cameraFov?: number;
  /** Framing target (#306/#6): 'all' extrusion (default) or the printed 'object' (excludes skirt/prime). */
  frameContent?: 'object' | 'all';
  colorMode?: ColorMode;
  tube?: TubeOptions;
  /** Bounded declarative theme (#153, DD-009 D4); headless stills theme identically. */
  theme?: Theme;
  /**
   * Presentation-card convenience (#306): `'transparent'` composites the still on the consumer's card
   * (creates an alpha GL context so the unset scene background shows through), or a solid `ThemeColor`
   * paints a themed backdrop. Shorthand for wiring `theme.background` + an alpha `createRenderer`
   * yourself; an explicit `theme.background` or `createRenderer` you pass takes precedence.
   */
  background?: 'transparent' | ThemeColor;
  /** Bed geometry — a renderer volume or discovered MachineGeometry. */
  buildVolume?: BuildVolumeDef | MachineGeometry;
  /** Inclusive layer clip [start, end]. Omitted → whole model. A NaN bound rejects with `RangeError`. */
  layerRange?: [number, number];
  /** Draw only up to this segment (progress-style clip). null/omitted → whole model. NaN → `RangeError`. */
  scrub?: number | null;
  /** Include travel moves (default false — a still is a clean model-only image by default). */
  showTravel?: boolean;
  /** Include slicer wipe moves (default false — same clean-still default as {@link showTravel}). */
  showWipe?: boolean;
  /** Include CNC/laser Cut moves (default true — unlike travel/wipe, cuts ARE the model of a CNC file). */
  showCut?: boolean;
  /**
   * Camera: an explicit pose, or omitted for deterministic bounds framing. `position` / `target` must be
   * finite and `fov` in [10, 120] (the same rule as `cameraFov`), else `RangeError` before any work.
   */
  camera?: StillCameraPose;
  /** Worker factory for the bytes path (batteries default when omitted). */
  createWorker?: SessionOptions['worker'];
  /** Wire parse options for the bytes path (dialects/containers/plate/limits). */
  parseOptions?: WireParseOptions;
  /** GL backend injection (tests / exotic hosts). Default: WebGLRenderer. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
  /**
   * Parallel tube-geometry build for a big-plate still (DD-028 Phase 4). Default `'auto'` — in a
   * browser-class context with `Worker` (the headless-Chromium sidecar, an Electron window) the batteries
   * -included browser Web Worker pool builds tube chunks in parallel, byte-identical to serial. `'off'`
   * forces the synchronous path. No effect where `Worker` is absent.
   */
  geometryConcurrency?: 'auto' | 'off' | number;
  /**
   * Concurrency cap from the deployment's ACTUAL CPU grant (DD-028). `navigator.hardwareConcurrency`
   * reports the visible cores, which over-reports a CFS-throttled container (e.g. 4 visible / 2.0-CPU
   * quota → 2× oversubscription). A containerized caller (the sidecar) reads its cgroup `cpu.max` and
   * passes the quota here; the pool sizes to `min(hardwareConcurrency, this) − 1`. Omit off-container.
   */
  coreBudget?: number;
  /** Max in-flight tube-geometry bytes for the parallel build (DD-028 memory backpressure). A memory-
   *  limited container (e.g. 2 GiB) passes a fraction of its limit; the pool never exceeds it. */
  geometryMemoryBudgetBytes?: number;
  /**
   * Total CPU byte budget for the FINAL tube geometry (RR-006). This is a **different axis** from
   * `geometryMemoryBudgetBytes` (which caps the parallel build's in-flight working set): this bounds the
   * whole retained tube mesh and so decides whether a large plate renders as full **tubes** or degrades to
   * **lines**. The default is deliberately conservative (~450 MB CPU / ~900 MB peak once uploaded), so a
   * big full-sheet plate silently falls to lines even when the deployment has RAM to spare. A caller whose
   * resource policy says the RAM is available raises this to retain tubes on large plates (peak RAM
   * ≈ 2× the budget; the library does not read the container — sizing is the deployment's policy). Omit
   * for the default.
   */
  tubeByteBudget?: number;
  /**
   * Fidelity POLICY (DD-023 §4 D6, §5: "on both interactive and headless entry points"), forwarded to the
   * renderer exactly as `GcodePreview` does: `'adaptive'` (default — today's behaviour), `'full'` (no
   * decimation, no byte-budget tubes→lines fallback, so `tubeByteBudget` is ignored), or `'fast'` (flat
   * lines). Distinct from the geometry `quality` tier. Omit for the default.
   */
  qualityMode?: QualityPolicy;
  /** Geometry-worker factory override (tests / exotic hosts). Defaults to the browser Web Worker when
   *  `Worker` is available and `geometryConcurrency !== 'off'`. */
  createGeometryWorker?: () => GeometryWorkerLike;
}

export interface RenderStillResult {
  /** The same canvas passed in, now holding the rendered frame. */
  canvas: RenderTargetCanvas;
  width: number;
  height: number;
  layerCount: number;
  segmentCount: number;
  /** The quality tier actually rendered (resolves 'auto'). */
  quality: QualityMode;
  /**
   * Every-Nth extrusion decimation actually applied (1 = none). > 1 on large files — especially large
   * `tubes` cards bounded by the tube-segment budget (RR-006) — so a card can disclose "simplified for
   * size" honestly; layer boundaries are always kept. Pairs with `segmentCount` (segments drawn).
   */
  decimationApplied: number;
  /** True when the input was G-code bytes (a worker parse ran). */
  parsed: boolean;
}

/**
 * The error {@link renderStill} rejects with when the toolpath geometry build fails (instead of never
 * settling). Same shape as the parser's `ParseSessionError`, so a still job handles a parse failure and a
 * build failure the same way: branch on `code`, show `message`.
 *
 * - `code` — the renderer's error code, e.g. `'E_GEOMETRY_BUILD'`.
 * - `message` — the renderer's description of what failed.
 *
 * The internal renderer is already disposed when this rejection arrives.
 */
export class RenderStillError extends Error {
  constructor(
    /** The renderer's error code, e.g. `'E_GEOMETRY_BUILD'`. */
    public readonly code: string,
    /** The renderer's description of what failed. */
    message: string
  ) {
    super(message);
    this.name = 'RenderStillError';
  }
}

function isToolpathIR(v: unknown): v is ToolpathIR {
  return (
    typeof v === 'object' &&
    v !== null &&
    'segments' in v &&
    'layers' in v &&
    'header' in v &&
    !(v instanceof Uint8Array) &&
    !(v instanceof ArrayBuffer)
  );
}

function toVolume(
  def: BuildVolumeDef | MachineGeometry,
  machineToVolume: (m: MachineGeometry) => BuildVolumeDef
): BuildVolumeDef {
  return 'bed' in def ? machineToVolume(def) : def;
}

/** A clip position: a number that is not NaN (±Infinity reads as "past the end", like the controller). */
function checkClip(name: string, value: unknown): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new RangeError(`renderStill ${name} needs a number that is not NaN (got ${String(value)})`);
  }
}

/** Three finite scene coordinates. A NaN or missing coordinate would render a blank still silently. */
function checkPoint(name: string, p: readonly unknown[]): void {
  for (let i = 0; i < 3; i++) {
    const v = p[i];
    // Number.isFinite is false for every non-number (no coercion), so it also rejects a string or undefined.
    if (!Number.isFinite(v)) {
      throw new RangeError(`renderStill camera.${name} must be three finite numbers (got ${String(v)} at [${i}])`);
    }
  }
}

/**
 * The option rules, checked before any parse or GL work so a bad still fails fast with `RangeError`
 * (never clamped): output size finite and greater than 0, pose fov in [10, 120], pose position/target finite,
 * `scrub` / `layerRange` not NaN.
 */
function checkStillOptions(options: RenderStillOptions, width: number, height: number): void {
  if (options.cameraFov !== undefined) checkCameraFov(options.cameraFov);
  for (const [name, v] of [
    ['width', width],
    ['height', height]
  ] as const) {
    if (!(Number.isFinite(v) && v > 0)) {
      throw new RangeError(`renderStill ${name} must be a positive finite number (got ${String(v)})`);
    }
  }
  const pose = options.camera;
  if (pose !== undefined) {
    if (pose.fov !== undefined) checkCameraFov(pose.fov);
    checkPoint('position', pose.position);
    checkPoint('target', pose.target);
  }
  if (options.scrub !== undefined && options.scrub !== null) checkClip('scrub', options.scrub);
  if (options.layerRange !== undefined) {
    checkClip('layerRange[0]', options.layerRange[0]);
    checkClip('layerRange[1]', options.layerRange[1]);
  }
}

/**
 * Render one still image. Resolves after the geometry is fully built and a single
 * frame has been drawn to `options.canvas`. Rejects (with an `Error` whose `code` is `E_GEOMETRY_BUILD`)
 * when the geometry build fails; the internal renderer is disposed on every outcome.
 */
export async function renderStill(
  source: Uint8Array | ArrayBuffer | ToolpathIR,
  options: RenderStillOptions
): Promise<RenderStillResult> {
  const { canvas } = options;
  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;
  checkStillOptions(options, width, height);

  let ir: ToolpathIR;
  let parsed = false;
  if (isToolpathIR(source)) {
    ir = source;
  } else {
    const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
    const session = new GcodeParseSession(options.createWorker === undefined ? {} : { worker: options.createWorker });
    try {
      const result = await session.parse(bytes, options.parseOptions ?? {});
      ir = result.ir;
      parsed = true;
    } finally {
      session.dispose();
    }
  }

  // Loaded on demand, like the controller's 3D renderer: a static import here would put three.js in
  // every bundle that imports core, 2D-only ones included.
  const { ToolpathRenderer, createDefaultGLRenderer, createBrowserGeometryWorker, machineToVolume } = await import(
    '@chestnutlabs/gcode-renderer-three'
  );

  // `background` shorthand (#306): a solid color merges into the theme; 'transparent' leaves the scene
  // background unset AND creates an alpha GL context so the card shows through. Explicit theme.background
  // / createRenderer win.
  const transparent = options.background === 'transparent';
  const bgColor = options.background !== undefined && !transparent ? options.background : undefined;
  const resolvedTheme: Theme | undefined =
    bgColor !== undefined
      ? { ...(options.theme ?? {}), background: options.theme?.background ?? bgColor }
      : options.theme;
  const resolvedCreateRenderer =
    options.createRenderer ??
    (transparent
      ? (c: RenderTargetCanvas) => createDefaultGLRenderer(c, { alpha: true, preserveDrawingBuffer: true })
      : undefined);

  // Build to completion off the event loop (no rAF): microtask-scheduled ticks. `renderDuringBuild:
  // false` suppresses the per-tick render — a still captures only the final frame, so rendering the
  // partial scene on every one of the (potentially hundreds of) build ticks is pure waste and, in
  // software WebGL, the dominant cost of a large still. The single frame()/render() below draws once.
  // DD-028 Phase 4: parallelize the tube build for a big-plate still. renderStill runs in a browser-class
  // WebGL2 context (headless Chromium / Electron / OffscreenCanvas worker — never raw Node), so the pool
  // uses browser Web Workers. Default the batteries-included factory when `Worker` exists; a containerized
  // caller passes `coreBudget` (its cgroup CPU quota) so the pool sizes to the throttle, not the visible
  // core count — `navigator.hardwareConcurrency` over-reports a CFS-limited container.
  const geometryPoolOpts: {
    geometryConcurrency?: 'auto' | 'off' | number;
    coreBudget?: number;
    geometryMemoryBudgetBytes?: number;
    createGeometryWorker?: () => GeometryWorkerLike;
  } = {};
  if (options.geometryConcurrency !== 'off') {
    const factory =
      options.createGeometryWorker ?? (typeof Worker !== 'undefined' ? createBrowserGeometryWorker : undefined);
    if (factory !== undefined) {
      geometryPoolOpts.geometryConcurrency = options.geometryConcurrency ?? 'auto';
      geometryPoolOpts.createGeometryWorker = factory;
      if (options.coreBudget !== undefined) geometryPoolOpts.coreBudget = options.coreBudget;
      if (options.geometryMemoryBudgetBytes !== undefined) {
        geometryPoolOpts.geometryMemoryBudgetBytes = options.geometryMemoryBudgetBytes;
      }
    }
  }

  const renderer = new ToolpathRenderer({
    canvas,
    quality: options.quality ?? 'auto',
    renderDuringBuild: false,
    ...geometryPoolOpts,
    ...(options.cameraMode ? { cameraMode: options.cameraMode } : {}),
    ...(options.cameraFov !== undefined ? { cameraFov: options.cameraFov } : {}),
    ...(options.frameContent ? { frameContent: options.frameContent } : {}),
    ...(resolvedTheme ? { theme: resolvedTheme } : {}),
    ...(options.colorMode ? { colorMode: options.colorMode } : {}),
    ...(options.tube ? { tube: options.tube } : {}),
    ...(options.tubeByteBudget !== undefined ? { tubeByteBudget: options.tubeByteBudget } : {}),
    ...(options.qualityMode !== undefined ? { qualityMode: options.qualityMode } : {}),
    ...(options.buildVolume ? { buildVolume: toVolume(options.buildVolume, machineToVolume) } : {}),
    preserveDrawingBuffer: true,
    scheduleFrame: (cb) => queueMicrotask(cb),
    ...(resolvedCreateRenderer ? { createRenderer: resolvedCreateRenderer } : {})
  });

  try {
    renderer.resize(width, height);

    let decimationApplied = 1;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error): void => {
        if (settled) return;
        settled = true;
        off();
        if (err === undefined) resolve();
        else reject(err);
      };
      const off = renderer.onEvent((e) => {
        if (e.type === 'buildComplete') {
          decimationApplied = e.decimationApplied;
          finish();
        } else if (e.type === 'error') {
          // A failed geometry build emits `error` (E_GEOMETRY_BUILD) and never `buildComplete` — without
          // this branch the await never settles and the renderer is never disposed (#435). Every `error`
          // the renderer can emit inside this window (setIR → buildComplete) is that build failure; the
          // non-fatal disclosures come from setColorMode/setFrameContent/setBuildVolume, which renderStill
          // only calls after the build settles. Rejecting on any code also keeps a future fatal code from
          // re-introducing the hang.
          finish(new RenderStillError(e.code, e.message));
        }
      });
      renderer.setIR(ir);
      // An empty IR builds no chunks and may not emit buildComplete — guard on
      // the IR's own segment count (deterministic, not renderer state).
      if (ir.segments.count === 0) queueMicrotask(finish);
    });

    // Apply travel/wipe visibility UNCONDITIONALLY. The renderer defaults both visible, so only ever
    // turning them *on* (the old `if (showTravel === true)`) left `showTravel: false` — and the
    // documented default of false — a no-op, so travel always showed. Set them from the options every
    // time so a still honors the clean-thumbnail defaults (both off) and frames as a model-only image.
    renderer.setKindVisible('travel', options.showTravel === true);
    renderer.setKindVisible('wipe', options.showWipe === true);
    renderer.setKindVisible('cut', options.showCut !== false);
    if (options.colorMode) renderer.setColorMode(options.colorMode);
    if (options.layerRange) renderer.setLayerRange(options.layerRange[0], options.layerRange[1]);
    if (options.scrub !== undefined) renderer.setScrubPosition(options.scrub);

    const pose = options.camera;
    if (pose) {
      // `fov` only applies to the perspective projection; on an orthographic camera
      // it is meaningless and absent from the union type. Ortho frustum sizing already
      // happened in setIR()→frame() from the model bounds. Structural cast keeps this
      // module free of a direct `three` import (three is the renderer's peer dep).
      if (pose.fov !== undefined && (options.cameraMode ?? 'perspective') === 'perspective') {
        const cam = renderer.camera as { fov: number; updateProjectionMatrix(): void };
        cam.fov = pose.fov;
        cam.updateProjectionMatrix();
      }
      renderer.camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      renderer.camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    } else {
      renderer.frame(); // deterministic bounds framing + render
    }
    // The one render that puts the final pose on the (preserved) drawing buffer for read-back. The pose
    // branch relies on it; frame() renders too, so on that branch this is a harmless repeat.
    renderer.render();

    return {
      canvas,
      width,
      height,
      layerCount: renderer.layerCount,
      segmentCount: renderer.segmentCount,
      quality: renderer.activeQuality,
      decimationApplied,
      parsed
    };
  } finally {
    renderer.dispose();
  }
}
