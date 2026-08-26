/**
 * Client render-capability classification (DD-023 §4 D1, Phase A).
 *
 * Classifies the WebGL context a renderer is actually running on as **software** or **hardware** from its
 * `UNMASKED_RENDERER_WEBGL` string, so a later phase can size a generous budget on hardware and a
 * conservative one on software (DD-023 §4 D2/D3). This module is the shared classifier for both the
 * toolpath and model paths; it changes no rendering behavior on its own.
 *
 * Pure + fail-safe: `classifyRenderer` is a pure string classifier (no WebGL, fully testable in Node);
 * `detectRenderCapability` reads the string from a live context. The honesty rules (DD-023 §4 D1):
 *   - classify the INNER renderer, never the `ANGLE (...)` wrapper (headless Chromium wraps both hw and sw
 *     in an `ANGLE (...)` string);
 *   - an unrecognized string ⇒ `'unknown'` (a caller opts conservative — never assume hardware on unknown);
 *   - the `WEBGL_debug_renderer_info` extension can be absent (privacy-hardened clients) ⇒ detection is
 *     blind ⇒ `'unknown'`, and an explicit `capabilityHint` is the authoritative override;
 *   - a GPU that failed to init and fell back to SwiftShader still reads SwiftShader ⇒ classified software,
 *     which is the safe direction.
 */

/** What the renderer is actually running on (DD-023 §4 D1). `'unknown'` = detection was blind/unrecognized. */
export type RenderCapability = 'software' | 'hardware' | 'unknown';

/** Consumer intent about what the renderer is running on — CAN (DD-023 §4 D1). Distinct from `qualityMode`. */
export type CapabilityHint = 'auto' | 'software' | 'hardware';

/**
 * Consumer intent about desired fidelity — WANT (DD-023 §4 D6). Distinct from `capabilityHint` (CAN) and
 * from the existing geometry `QualityMode` (`'lines' | 'tubes'`, DD-004): this is the fidelity *policy*
 * surfaced as the `qualityMode` option — `'full'` never auto-degrades, `'adaptive'` reduces only on detected
 * need with disclosure, `'fast'` explicitly trades fidelity for speed.
 */
export type QualityPolicy = 'full' | 'adaptive' | 'fast';

/**
 * Case-insensitive inner-renderer markers of a **software** rasterizer. Matched against the whole string
 * (the inner renderer of an `ANGLE (...)` wrapper contains these too, e.g.
 * `ANGLE (Google, Vulkan ... (SwiftShader Device ...), SwiftShader driver)`).
 */
const SOFTWARE_MARKERS = [
  'swiftshader',
  'llvmpipe',
  'basic render driver', // Microsoft Basic Render Driver (WARP-less software fallback)
  'software rasterizer',
  'microsoft basic render',
  'softpipe',
  'lavapipe'
];

/**
 * Case-insensitive markers of a **hardware** GPU vendor/driver. Deliberately broad across desktop and
 * mobile GPUs so a real device is not misfiled as unknown (which would opt it conservative). Checked only
 * AFTER software markers, so a `Vulkan (SwiftShader ...)` string classifies software even though it names
 * a vendor.
 */
const HARDWARE_MARKERS = [
  'nvidia',
  'geforce',
  'quadro',
  'radeon',
  'radeonsi',
  'amd ',
  'intel', // "Mesa Intel(R) ...", "Intel(R) UHD ..." — Intel iGPUs are hardware
  'apple', // Apple M-series / Apple GPU
  'adreno',
  'mali',
  'powervr',
  'mesa', // Mesa hardware drivers (radeonsi/iris/etc.) — but llvmpipe/softpipe are caught as software first
  'iris',
  'metal',
  'directx', // ANGLE (…, Direct3D11 vs_5_0 ps_5_0, D3D11) on a real GPU
  'd3d11',
  'vega',
  'rtx',
  'gtx'
];

/**
 * Classify a raw `UNMASKED_RENDERER_WEBGL` string as software / hardware / unknown (DD-023 §4 D1). Pure.
 *
 * Software markers win over hardware markers, because a software ANGLE string can also name a vendor
 * (`ANGLE (Google, Vulkan 1.3 (SwiftShader Device (LLVM 10)), SwiftShader driver)` contains "Vulkan" but is
 * software). An empty / whitespace / unrecognized string is `'unknown'` — the caller then opts conservative.
 */
export function classifyRenderer(rendererString: string | null | undefined): RenderCapability {
  if (rendererString === null || rendererString === undefined) return 'unknown';
  const s = rendererString.toLowerCase().trim();
  if (s.length === 0) return 'unknown';
  for (const m of SOFTWARE_MARKERS) {
    if (s.includes(m)) return 'software';
  }
  for (const m of HARDWARE_MARKERS) {
    if (s.includes(m)) return 'hardware';
  }
  return 'unknown';
}

/** Minimal shape of the bits of a WebGL(2) context this module reads — keeps the module `three`-free. */
export interface RendererInfoContext {
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
}

/** Result of reading a live context (DD-023 §4 D1). `rawRenderer` is `null` when the extension was absent. */
export interface DetectedCapability {
  capability: RenderCapability;
  /** The raw `UNMASKED_RENDERER_WEBGL` string, or `null` when `WEBGL_debug_renderer_info` was unavailable. */
  rawRenderer: string | null;
}

/**
 * Read a live WebGL context's unmasked renderer and classify it (DD-023 §4 D1). Reading the unmasked
 * renderer needs the `WEBGL_debug_renderer_info` extension; when it is gated/absent (some privacy-hardened
 * browsers) this returns `{ capability: 'unknown', rawRenderer: null }` — detection is blind and the caller
 * falls back to an explicit `capabilityHint`. Never throws: any failure classifies `'unknown'`.
 */
export function detectRenderCapability(gl: RendererInfoContext): DetectedCapability {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    if (ext === null || ext === undefined) return { capability: 'unknown', rawRenderer: null };
    const raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    if (typeof raw !== 'string' || raw.length === 0) return { capability: 'unknown', rawRenderer: null };
    return { capability: classifyRenderer(raw), rawRenderer: raw };
  } catch {
    return { capability: 'unknown', rawRenderer: null };
  }
}

/**
 * Resolve the effective capability from a consumer `capabilityHint` and the detected capability (DD-023
 * §4 D1). An explicit `'software'`/`'hardware'` hint is authoritative (it is how a consumer overrides blind
 * detection); `'auto'` uses detection; and a `'unknown'` detection resolves **conservatively to `'software'`**
 * — never optimistically to hardware, since misclassifying a software client as hardware is the failure that
 * OOMs / hangs, while over-conserving a hardware client only loses some static fidelity.
 */
export function resolveCapability(
  hint: CapabilityHint | undefined,
  detected: RenderCapability
): 'software' | 'hardware' {
  if (hint === 'software' || hint === 'hardware') return hint;
  // hint is 'auto' or undefined ⇒ trust detection, conservative on unknown.
  return detected === 'hardware' ? 'hardware' : 'software';
}
