# DD-018 — ModelRenderer: source-model presentation rendering (STL / 3MF)

**Status:** Proposed <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (maintainer)
**Date:** 2026-08-23 · **Last revised:** 2026-08-23
**Owning Epic:** new — "Presentation rendering / ModelRenderer" (epic issue to be created on acceptance) · **Milestone:** M1 (v1)
**Supersedes / Superseded by:** none
**Related:** DD-004 (Three.js rendering), DD-005 (container/ZIP adapters — `.3mf` unzip), DD-008 (release/versioning, new-package checklist), DD-007 §4.8 / `renderStill` (headless still contract), AnyBridge thumbnail sidecar (#791), issue #292 (the fix that clarified the reframe).

---

## 1. Problem

AnyBridge (the first consumer) needs a **card/list/inspector thumbnail** that answers *"what object is this?"*. Until now that has been produced by pointing `renderStill` at the **toolpath** — the extrusion/travel geometry of a sliced G-code file. Repeated tuning of the toolpath renderer for thumbnails (travel visibility #292, tube quality, background, framing) kept feeling wrong because it **is** wrong: a toolpath render answers *"what does this toolpath do?"*, a diagnostic question, not *"what object is this?"*.

These are two distinct rendering jobs on the same Three.js foundation:

- **View-in-3D (toolpath inspection):** extrusion tubes, layers, travel, wipe/retractions, speed/tool/filament color modes. This is exactly what the current `ToolpathRenderer` / `renderStill` do well — **keep as-is**.
- **Presentation thumbnail (model render):** a clean, attractive image of the *source model* (STL/3MF), no travel/tubes, good at small card sizes, ideally a multicolor image for a multicolor model **without slicing first**.

The strategic need is concrete, not speculative: a significant share of AnyBridge's real files are **multicolor 3MF** models, and the product goal is that a multicolor model produces a multicolor presentation thumbnail directly from its source data. Coercing the toolpath renderer cannot do this — the color/material information lives in the source model, not the toolpath.

This DD decides that we add a **first-class sibling `ModelRenderer`** in this repository, on the shared Three.js foundation, exposed as a new package, with a headless still preset for thumbnails.

## 2. Scope

- A new lockstep package **`@chestnutlabs/gcode-model-renderer`** (the 14th `@chestnutlabs/*` package).
- A **`ModelRenderer`** class mirroring the shape of `ToolpathRenderer` (canvas, theme, `createRenderer` injection, `resize`, `frame`, `getCameraState`/`setCameraState`, `dispose`), operating on a **`ModelScene`** (see §4).
- A **`renderModelStill(source, options)`** function mirroring `renderStill` — the headless, single-render presentation preset used by AnyBridge's thumbnail worker.
- **Source inputs:** STL (binary + ASCII) and 3MF (multi-object: geometry, per-object transforms, arrangement, and material/color assignments when present).
- A **presentation preset:** deterministic auto-fit, a fixed attractive 3/4 (isometric) angle, neutral "studio" lighting, and a background that is **either transparent** (for compositing on a card) **or a themed solid color**.
- **Shared "stage" extraction:** factor the scene/camera/theme/offscreen-export machinery currently inside `renderStill`/the Three renderer into a small shared layer both `ToolpathRenderer` and `ModelRenderer` sit on, so they cannot drift.
- **Deterministic export** (same input + same environment ⇒ identical bytes) and a stable **cache key** contract.

v1 delivers STL **and** 3MF, implemented **sequentially** (see §14): shared foundation → STL proving slice → 3MF multi-object/color → v1 acceptance. The 3MF requirements are designed up front (this DD) so the STL slice does not lock in an API or scene model that 3MF would force us to replace.

## 3. Non-goals

- **Slicing.** ModelRenderer renders source geometry directly; it never invokes a slicer.
- **Toolpath visualization.** That remains `ToolpathRenderer` / `renderStill`, unchanged.
- **Cross-GPU pixel identity.** Determinism is promised **per environment** only (antialiasing/driver variance across GPUs is expected). Cache keys therefore include an environment id.
- **Windowed/native GL** (GLX/GLFW). The contract is offscreen/OffscreenCanvas via ANGLE→SwiftShader (software GL), the path AnyBridge's headless worker already runs and which we require here. A windowed path is explicitly excluded (it has been shown to fail headless).
- **Additional source formats** (STEP, OBJ, glTF) — out of v1; the scene model is designed so they could be added as new loaders later without an API break.
- **Interactive larger preview pane.** A real orbitable preview surface is a **later consumer** of the same `ModelRenderer` (§14); v1 must not preclude it, but does not build it.
- No core/renderer package may depend on AnyBridge (DD-002 invariant).

## 4. Data contracts / API

The API is designed **multi-object and material-capable from day one**. STL is the degenerate single-object, no-material case; 3MF is the general case. This is the crux of the "don't lock STL-first into something 3MF replaces" requirement.

### 4.1 Scene model (renderer-agnostic, three-free types)

```ts
/** A presentation scene: one or more positioned objects. */
export interface ModelScene {
  objects: ModelObject[];
  /** Overall bounds of all objects in scene units (mm assumed; source-declared when available). */
  bounds: ModelBounds;
  /** Capability honesty (mirrors DD-001): what the source actually carried. */
  capabilities: {
    materials: Confidence;   // 'known' when the source assigned colors/materials, else 'unavailable'
    transforms: Confidence;  // 'known' for 3MF component transforms, 'unavailable'/'inferred' for STL
    multiObject: Confidence; // 'known' when >1 object was declared
  };
}

export interface ModelObject {
  id: string;                     // stable within a scene (3MF object id; 'stl' for STL)
  name?: string;                  // source-declared object name when present
  geometry: MeshGeometry;         // positions + optional normals + optional per-vertex/triangle color refs
  transform: Mat4;                // object→scene transform (identity for STL)
  material?: ModelMaterial;       // omitted ⇒ no source material ⇒ neutral default + materials:'unavailable'
}

export interface ModelMaterial {
  /** Base color as [r,g,b] in 0..1 (three-free), when the source declared one. */
  color?: RGB;
  /** Future: metalness/roughness/named PBR preset — reserved, optional. */
}
```

- **Honesty rule (DD-001 ethos):** a model with no declared material/color renders with a **neutral default** material and reports `materials: 'unavailable'` — it never fabricates colors. A multicolor 3MF reports `materials: 'known'` and its per-object/per-region colors are preserved.
- `MeshGeometry`, `RGB`, `Mat4`, `Confidence`, `ModelBounds` are three-free public types (numbers/typed arrays), so the package's public surface does not leak `three` (same discipline as DD-009 theme types and the `GLRendererLike` seam).

### 4.2 `ModelRenderer` (interactive/imperative surface)

```ts
class ModelRenderer {
  constructor(opts: {
    canvas: RenderTargetCanvas;
    theme?: ModelTheme;                 // background (null=transparent | color), lighting preset, env
    createRenderer?: (c: RenderTargetCanvas) => GLRendererLike; // GL injection (tests/headless)
    preserveDrawingBuffer?: boolean;
    scheduleFrame?: (cb: () => void) => void;
  });
  setScene(scene: ModelScene): void;    // build meshes, materials, framing
  resize(w: number, h: number): void;
  frame(view?: PresentationView): void; // deterministic auto-fit at a preset angle
  getCameraState(): CameraState;        // same serializable contract as ToolpathRenderer (#268)
  setCameraState(s: CameraState): void;
  render(): void;
  dispose(): void;
}
```

`CameraState`, `GLRendererLike`, `RenderTargetCanvas` are **reused verbatim** from the shared stage (§4.4) — a dashboard that persists a toolpath camera can persist a model camera the same way.

### 4.3 `renderModelStill` (headless preset — the thumbnail path)

```ts
async function renderModelStill(
  source: ModelSource,              // { kind:'stl'; bytes } | { kind:'3mf'; bytes } | ModelScene
  options: RenderModelStillOptions
): Promise<RenderModelStillResult>;

interface RenderModelStillOptions {
  canvas: RenderTargetCanvas;       // OffscreenCanvas (worker) or DOM canvas
  width?: number; height?: number;
  /** Background: 'transparent' (composite on card) or a solid ThemeColor. Default 'transparent'. */
  background?: 'transparent' | ThemeColor;
  view?: PresentationView;          // preset angle; default 'iso'
  lighting?: 'studio' | 'flat';     // default 'studio'
  createRenderer?: (c: RenderTargetCanvas) => GLRendererLike;
  limits?: ModelLimits;             // §7
}

interface RenderModelStillResult {
  canvas: RenderTargetCanvas;
  width: number; height: number;
  objectCount: number;
  materials: Confidence;            // surfaced so the consumer knows if colors were real
  /** Stable identity for caching: hash(sourceBytes) + serialized options + envId. */
  cacheKey: string;
}
```

- **Background** covers both AnyBridge needs explicitly: `'transparent'` (the common card case — requires the injected/default GL to be created with `alpha:true`, which `renderModelStill`'s default `createRenderer` sets, unlike the toolpath default) and a solid themed color.
- `PresentationView` = `'iso' | 'front' | 'top' | ...` — a small fixed set; `'iso'` is the default 3/4 presentation angle.

### 4.4 Shared "stage" layer

Extract from the current Three renderer / `renderStill` into a shared module (location TBD in §12 — a small internal package or a shared subpath):

- The **offscreen/headless render contract**: build-to-completion, `preserveDrawingBuffer`, `GLRendererLike` injection, single deterministic `render()`, the microtask `scheduleFrame` default.
- **Camera/framing**: `frame()` auto-fit math (`viewHalfHeight`, radius-from-bounds), `getCameraState`/`setCameraState`, the Z-up→Y-up root convention.
- **Theme primitives**: background (transparent/solid), light rig, material presets (extended with a "studio" preset for presentation).
- **`GLRendererLike`, `RenderTargetCanvas`, `CameraState`** type contracts.

`ToolpathRenderer` and `ModelRenderer` both consume this. The extraction is behavior-preserving for the toolpath side (golden/visual parity required — §9).

## 5. Lifecycle

`ModelRenderer`: construct → `setScene` (parse/normalize source into `ModelScene`, build three meshes/materials, frame) → `render`/`frame`/camera ops → `dispose` (free geometries, materials, GL). `renderModelStill`: parse source → build scene → build-to-completion → single render → return canvas + cacheKey → dispose internally (mirrors `renderStill`). 3MF parsing unzips via the DD-005 container reader, then parses the 3D model XML into `ModelScene`.

## 6. Errors & failure behavior

- Malformed/empty STL or 3MF → a structured error (`E_MODEL_PARSE`), never a partial fabricated mesh.
- 3MF with no materials → success with `materials: 'unavailable'` (neutral render), not an error.
- Over-limit input (§7) → `BudgetExceededError`-style bounded failure, same discipline as the parser (DD-003).
- Empty scene (no objects) → a defined result (blank framed canvas) with `objectCount: 0`, not a throw.

## 7. Security & resource limits

Source models are **untrusted input** (same threat posture as G-code/containers; nothing is executed).

- **3MF = ZIP** → reuse the DD-005 container hardening verbatim: reject zip-bombs, zip64 abuse, path traversal; entry-count / per-entry / total-expanded-size caps. (Security-reviewed; see SECURITY-REVIEW-DD-005.)
- **STL / mesh geometry** → bounded triangle/vertex counts and bounded allocation (`ModelLimits`: maxTriangles, maxObjects, maxExpandedBytes). Reject before allocating.
- No code execution, no file-initiated network access, no filesystem access (the module renders bytes handed to it; consumer owns I/O).
- Textures/materials from 3MF: v1 supports **solid colors only**; external texture references are ignored (not fetched) — no network egress.

## 8. Performance

- Thumbnail budget derived from the existing `renderStill` headless baseline (AnyBridge worker: Chromium/ANGLE→SwiftShader, OffscreenCanvas). Target: a single card thumbnail (e.g. ≤512²) renders within the same order as a toolpath still on that path. Measured on the established low-resource host (`hubulinu`) and the worker path, not invented.
- Mesh rendering is generally **cheaper** than tube toolpath geometry (one build, no per-layer chunking), so the toolpath budgets (DD-004 §8) are a conservative ceiling. Confirm with a benchmark fixture before v1 acceptance.

## 9. Testing

- **MIT-clean synthetic fixtures only** (no third-party models whose license can't be established — same rule as CNC fixtures): a synthetic binary STL, an ASCII STL, a single-object 3MF, and a **multi-object multicolor 3MF** authored in-repo.
- **Determinism test:** same source + same (stub) GL ⇒ identical draw calls / identical serialized frame; `cacheKey` stable across runs and sensitive to source/option changes.
- **Scene-model contract tests:** STL → 1 object, `materials:'unavailable'`, identity transform; multicolor 3MF → N objects, `materials:'known'`, per-object colors preserved, transforms applied.
- **Capability honesty:** a 3MF without materials reports `unavailable` and renders neutral (never fabricated color).
- **Shared-stage parity:** the toolpath renderer's existing golden/visual tests must remain byte-identical after the stage extraction (the extraction is refactor-only for the toolpath side).
- **Security:** adversarial 3MF (zip-bomb/traversal) and over-limit STL rejected within budget (reuse the container adversarial corpus patterns).

## 10. Migration

- **New package** → the DD-008 new-package checklist applies: workspace glob, `tools/docs/build-api.mjs` PACKAGES, `typedoc.json` entryPoints, `tools/release/publish.mjs` ORDER, `.eslintrc.js` overrides, pack-check snapshot (`UPDATE_PACK_SNAPSHOTS=1`), support-policy, consumer fixtures, changesets fixed-group (auto-included). `three` is a **peerDependency** (as with `gcode-renderer-three`); mesh loaders (STL/3MF geometry) are the package's own deps.
- **Shared-stage extraction** touches `gcode-renderer-three` / `gcode-preview-core`/`renderStill` internals but is **API-preserving** for existing consumers (no public change to `ToolpathRenderer`/`renderStill`). Any shared types that move are re-exported from their current homes to avoid a breaking import path.
- Consumers: additive. AnyBridge adopts `renderModelStill` in the headless worker; the toolpath View-in-3D path is unchanged (and still benefits from #292 on 0.5.2).

## 11. Observability / diagnostics

- `materials`/`transforms`/`multiObject` capability confidences surfaced on the result (privacy-preserving; no local paths).
- A disclosure when a requested feature is honestly degraded (e.g. `background:'transparent'` requested but the injected GL lacks alpha → disclosed, not silently opaque).
- Warnings for ignored 3MF features (external textures, unsupported material types) so a consumer knows the render is an approximation.

## 12. Alternatives considered

- **Subpath `@chestnutlabs/gcode-preview/model`** instead of a new package. Rejected as the v1 shape (kept as a fallback): a subpath makes a toolpath-only consumer risk pulling mesh loaders unless everything is perfectly lazy-loaded; a separate package draws the dependency boundary cleanly and still versions in lockstep. AnyBridge's headless worker (the main consumer) prefers a separate dep; the View-in-3D viewer must not pull mesh code. **Chosen: new package.**
- **Coerce `ToolpathRenderer`** to render meshes / keep tuning the toolpath thumbnail. Rejected — the reframe that motivates this DD; it cannot preserve source colors without slicing and conflates two products.
- **AnyBridge builds its own Three.js model renderer.** Rejected by the owner — duplicates the foundation, not reusable, drifts from the shared stage. AnyBridge consumes, does not re-implement.
- **Where the shared stage lives:** (a) a new internal `@chestnutlabs/render-stage` package, vs (b) a shared subpath of an existing renderer package, vs (c) keep it in `gcode-renderer-three` and depend on that from the model package. Leaning (c) short-term (least churn — model package peer-deps three and imports the shared stage from the three renderer) with (a) as a clean-up if coupling grows. **Open for acceptance review.**

## 13. Risks

- **3MF breadth.** The 3MF spec is large (components, build items, materials, textures). Mitigation: v1 supports geometry + transforms + **solid colors**; everything else is ignored-with-disclosure, designed as additive later.
- **Material/color model fidelity.** Multicolor 3MF can encode color per-object, per-triangle (material groups), or via textures. v1 targets per-object and per-triangle **solid** color; textures deferred. The `ModelMaterial`/geometry color-ref model is designed to extend.
- **three version coupling / determinism.** Loader/render output can change across `three` versions → fold the renderer/three version into `envId` in the cache key; pin behavior with the determinism test.
- **Bundle size** (mesh loaders). Contained by the separate-package boundary; loaders are the model package's concern only.
- **Shared-stage extraction regressions** on the toolpath side. Mitigation: extraction is refactor-only and gated by existing golden/visual parity.

## 14. Phased delivery

Sequential within v1 (each phase reviewable; 3MF designed up front so no rework):

- **Phase 0 — Shared stage.** Extract scene/camera/theme/offscreen-export from `renderStill`/three renderer into the shared layer; prove toolpath parity (goldens byte-identical). No new public API.
- **Phase 1 — STL proving slice.** New package; `ModelScene` (single-object case), `ModelRenderer`, `renderModelStill` for STL; presentation preset (iso, studio lighting), transparent + themed bg; deterministic export + cache key; offscreen/SwiftShader contract; MIT-clean STL fixtures. This proves the foundation end-to-end.
- **Phase 2 — 3MF multi-object/color.** 3MF via the DD-005 ZIP reader → multi-object `ModelScene` with transforms/arrangement and per-object/per-triangle solid colors; multicolor thumbnail without slicing. Multicolor 3MF fixture + capability-honesty tests. **Completes v1.**
- **Later (not v1, non-blocking):** a larger interactive **preview pane** consuming the same `ModelRenderer` (orbit, resize); additional formats (STEP/OBJ/glTF) as new loaders on the same scene model.

## 15. Acceptance criteria

- New package `@chestnutlabs/gcode-model-renderer` published in lockstep; `three` peer-dep; no dependency on AnyBridge; new-package checklist (DD-008) satisfied.
- `ModelScene` / `ModelRenderer` / `renderModelStill` public surface is three-free and multi-object + material-capable from the first release (STL and 3MF share it; no breaking change between phases).
- STL (binary + ASCII) → correct single-object presentation render; multicolor 3MF → multi-object render with **source colors preserved** and `materials:'known'`; a colorless model renders neutral with `materials:'unavailable'` (no fabricated color).
- `renderModelStill` runs on OffscreenCanvas via ANGLE→SwiftShader (the AnyBridge worker path), with working **transparent** and **themed-solid** backgrounds.
- Deterministic per-environment export; stable `cacheKey` sensitive to source + options + `envId`.
- Untrusted-input limits enforced (3MF ZIP hardening reused; STL triangle/alloc caps); adversarial fixtures rejected within budget.
- Shared-stage extraction leaves the toolpath renderer's public API and golden/visual output unchanged.
- Docs: manual page + typedoc for the new package; the thumbnail-precedence guidance (embedded slicer thumb → source-model via ModelRenderer → gcode presentation fallback → raw toolpath last) documented for consumers.
