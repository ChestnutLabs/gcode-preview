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
import {
  ToolpathRenderer,
  createDefaultGLRenderer,
  machineToVolume,
  type BuildVolumeDef,
  type CameraMode,
  type ColorMode,
  type GLRendererLike,
  type QualityMode,
  type RenderTargetCanvas,
  type Theme,
  type ThemeColor,
  type TubeOptions
} from '@chestnutlabs/gcode-renderer-three';
import { type MachineGeometry, type ToolpathIR } from '@chestnutlabs/toolpath-core';

/** Explicit camera pose (scene coordinates), overriding the deterministic frame(). */
export interface StillCameraPose {
  position: [number, number, number];
  target: [number, number, number];
  /** Vertical field of view in degrees (default: the renderer's 50°). */
  fov?: number;
}

export interface RenderStillOptions {
  /** Target surface: an OffscreenCanvas (worker/headless) or a DOM canvas. Required. */
  canvas: RenderTargetCanvas;
  /** Output size. Defaults to the canvas's current width/height. */
  width?: number;
  height?: number;
  /** Quality tier (default 'auto': tubes ≤ 1 M segments, else lines). */
  quality?: QualityMode | 'auto';
  /** Camera projection (#150, DD-009 D3); default 'perspective'. */
  cameraMode?: CameraMode;
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
  /** Inclusive layer clip [start, end]. Omitted → whole model. */
  layerRange?: [number, number];
  /** Draw only up to this segment (progress-style clip). null/omitted → whole model. */
  scrub?: number | null;
  /** Include travel moves (default false — a still is a clean model-only image by default). */
  showTravel?: boolean;
  /** Include slicer wipe moves (default false — same clean-still default as {@link showTravel}). */
  showWipe?: boolean;
  /** Camera: an explicit pose, or omitted for deterministic bounds framing. */
  camera?: StillCameraPose;
  /** Worker factory for the bytes path (batteries default when omitted). */
  createWorker?: SessionOptions['worker'];
  /** Wire parse options for the bytes path (dialects/containers/plate/limits). */
  parseOptions?: WireParseOptions;
  /** GL backend injection (tests / exotic hosts). Default: WebGLRenderer. */
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike;
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

function toVolume(def: BuildVolumeDef | MachineGeometry): BuildVolumeDef {
  return 'bed' in def ? machineToVolume(def) : def;
}

/**
 * Render one still image. Resolves after the geometry is fully built and a single
 * frame has been drawn to `options.canvas`.
 */
export async function renderStill(
  source: Uint8Array | ArrayBuffer | ToolpathIR,
  options: RenderStillOptions
): Promise<RenderStillResult> {
  const { canvas } = options;
  const width = options.width ?? canvas.width;
  const height = options.height ?? canvas.height;

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

  // Build to completion off the event loop (no rAF): microtask-scheduled ticks.
  const renderer = new ToolpathRenderer({
    canvas,
    quality: options.quality ?? 'auto',
    ...(options.cameraMode ? { cameraMode: options.cameraMode } : {}),
    ...(options.frameContent ? { frameContent: options.frameContent } : {}),
    ...(resolvedTheme ? { theme: resolvedTheme } : {}),
    ...(options.colorMode ? { colorMode: options.colorMode } : {}),
    ...(options.tube ? { tube: options.tube } : {}),
    ...(options.buildVolume ? { buildVolume: toVolume(options.buildVolume) } : {}),
    preserveDrawingBuffer: true,
    scheduleFrame: (cb) => queueMicrotask(cb),
    ...(resolvedCreateRenderer ? { createRenderer: resolvedCreateRenderer } : {})
  });

  try {
    renderer.resize(width, height);

    let decimationApplied = 1;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        off();
        resolve();
      };
      const off = renderer.onEvent((e) => {
        if (e.type === 'buildComplete') {
          decimationApplied = e.decimationApplied;
          finish();
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
      renderer.render();
    } else {
      renderer.frame(); // deterministic bounds framing + render
    }
    // frame()/setColorMode already render; one explicit render guarantees the
    // final state is on the (preserved) drawing buffer for read-back.
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
