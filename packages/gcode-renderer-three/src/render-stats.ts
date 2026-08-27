/**
 * Render diagnostics — the `RenderStats` snapshot (DD-027).
 *
 * A capability-honest, read-only picture of *what the renderer is actually running on* and *why a
 * build was slow or degraded*. The renderer assembles it at build-complete from state it already
 * computes (the DD-023 capability classifier, the chunk build result, emitted disclosures) plus a few
 * `performance.now()` marks. Every field is a real measured value or `null`/`'unknown'` — a backend
 * that genuinely cannot provide a value (the 2D canvas has no GPU; a privacy-hardened context gates the
 * renderer string; parse timing is a core-side concern the renderer never sees) reports the absence,
 * never a fabricated `0`/empty string.
 *
 * The `parseMs` and `totalReadyMs` fields are `null` on the renderer-produced snapshot: the renderer
 * does not observe parse start. `@chestnutlabs/gcode-preview-core` fills them in when it re-emits the
 * snapshot (DD-027 Phase 2), because only it spans parse-start → first render.
 */
import { classifyRenderer, type RenderCapability } from './capability.js';

/** A single immutable render-diagnostics snapshot (DD-027 §4). */
export interface RenderStats {
  // ─── "What renderer am I actually using?" ───
  /** Which rendering backend produced this frame. */
  backend: '3d-webgl' | '2d-canvas';
  /** WebGL major version, or `null` on the 2D backend / when the context type is unknown. */
  webglVersion: 1 | 2 | null;
  /** Hardware / software / unknown, from the DD-023 classifier over the unmasked renderer string. */
  capability: RenderCapability;
  /** Raw `UNMASKED_RENDERER_WEBGL` (e.g. `"ANGLE (NVIDIA ... RTX 4070 ..., D3D11)"`); `null` when the
   *  `WEBGL_debug_renderer_info` extension is gated/absent or the backend is 2D. */
  gpuRenderer: string | null;
  /** Raw `UNMASKED_VENDOR_WEBGL`; `null` under the same conditions as {@link gpuRenderer}. */
  gpuVendor: string | null;

  // ─── "Why did this take so long / lose quality?" ───
  /** The geometry representation actually built. */
  geometryMode: 'tubes' | 'lines';
  /** Segments present in the IR. */
  sourceSegmentCount: number;
  /** Segments actually built into geometry (after decimation / travel-hide). */
  renderedSegmentCount: number;
  /** Reduction factor applied to the LINES overview; `1` = nothing dropped (tubes are never decimated). */
  decimationApplied: number;
  /** Vertices in the built geometry, summed across chunks; `null` if not derivable. */
  vertexCount: number | null;
  /** Geometry draw batches (≈ chunk count); `null` when not meaningful (2D). */
  drawCalls: number | null;
  /** Bytes of tube geometry uploaded, when `geometryMode === 'tubes'`; `null` for lines / 2D. */
  tubeBytes: number | null;
  /** The tube byte budget that actually constrained the build (coarsened the cross-section or forced
   *  the tubes→lines fallback); `null` when the budget did not bind. */
  tubeByteBudget: number | null;
  /** The fidelity policy in force (DD-023). */
  qualityMode: 'full' | 'adaptive' | 'fast';
  /** Honest degradation reasons already emitted for this build (decimation, tubes→lines fallback); may
   *  be empty. */
  disclosures: string[];

  // ─── Timings (ms; `null` when the phase did not run / is unmeasurable) ───
  /** Parse duration — `null` on the renderer snapshot (core fills it; DD-027 Phase 2). */
  parseMs: number | null;
  /** CPU-side geometry build duration (build start → build complete). */
  geometryBuildMs: number | null;
  /** Time from build start to the first frame rendered. */
  firstRenderMs: number | null;
  /** Parse-start → first full render — `null` on the renderer snapshot (core fills it; Phase 2). */
  totalReadyMs: number | null;
}

/** The GPU-facing subset of {@link RenderStats}, probed once from a live WebGL renderer. */
export interface GpuInfo {
  webglVersion: 1 | 2 | null;
  capability: RenderCapability;
  gpuRenderer: string | null;
  gpuVendor: string | null;
}

/** GPU info for a context that could not be probed (2D backend, or a non-WebGL injected renderer). */
export const UNKNOWN_GPU_INFO: GpuInfo = {
  webglVersion: null,
  capability: 'unknown',
  gpuRenderer: null,
  gpuVendor: null
};

/** Minimal duck-typed shape of the bits of a WebGL context this module reads (keeps it `three`-free). */
interface WebGLContextLike {
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
}

/** Duck-typed shape of a GL renderer that can hand back its context + WebGL2 flag (three's `WebGLRenderer`). */
interface ProbeableRenderer {
  getContext?: () => WebGLContextLike | null;
  capabilities?: { isWebGL2?: boolean };
}

/**
 * Best-effort GPU probe over a renderer that *might* expose a WebGL context (DD-027 §4/§6). Reads the
 * unmasked renderer/vendor strings and the WebGL version, classifies hardware/software, and returns
 * {@link UNKNOWN_GPU_INFO} on any failure — an injected non-WebGL renderer, a gated
 * `WEBGL_debug_renderer_info`, or a throwing context. Never throws.
 */
export function probeGpuInfo(renderer: unknown): GpuInfo {
  try {
    const r = renderer as ProbeableRenderer;
    const gl = typeof r.getContext === 'function' ? r.getContext() : null;
    if (gl === null || gl === undefined) return UNKNOWN_GPU_INFO;
    const webglVersion: 1 | 2 | null =
      r.capabilities?.isWebGL2 === true ? 2 : r.capabilities?.isWebGL2 === false ? 1 : null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number;
      UNMASKED_VENDOR_WEBGL: number;
    } | null;
    if (ext === null || ext === undefined) {
      return { webglVersion, capability: 'unknown', gpuRenderer: null, gpuVendor: null };
    }
    const rawRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    const rawVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
    const gpuRenderer = typeof rawRenderer === 'string' && rawRenderer.length > 0 ? rawRenderer : null;
    const gpuVendor = typeof rawVendor === 'string' && rawVendor.length > 0 ? rawVendor : null;
    return { webglVersion, capability: classifyRenderer(gpuRenderer), gpuRenderer, gpuVendor };
  } catch {
    return UNKNOWN_GPU_INFO;
  }
}
