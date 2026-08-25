# DD-021 — Interactive source-model viewer (`ModelViewer`)

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (with Claude)
**Date:** 2026-08-24 · **Last revised:** 2026-08-24
**Owning Epic:** ModelRenderer (the DD-018 line) · **Milestone:** M2
**Supersedes / Superseded by:** none
**Related:** [DD-018](DD-018-model-renderer.md) (ModelRenderer / presentation stills), [DD-020](DD-020-interaction-aware-quality.md) (interaction-aware quality), [DD-004](DD-004-threejs-rendering-geometry-layer-clipping-and-quality-modes.md) (toolpath renderer + camera controls), [RR-005](../research/RR-005-3mf-paint-color-facet-format.md) (3MF paint decode). Consumer: AnyBridge "View in 3D".

> **Accepted** 2026-08-24 by the maintainer — all sections as drafted, including the two AnyBridge
> boundary-review refinements (the reserved additive `ready.info.objects` parts-list field §4.2, and the
> early-consumer-wraps-the-handle note §14). AnyBridge reviewed the §4.2 consumption seam end-to-end with
> no blockers; the AnyBridge-owner product sign-off is relayed separately. Hard acceptance constraint
> reaffirmed: **Phase 0 must leave the existing ToolpathRenderer behavior byte-for-byte / regression-
> protected** while extracting the shared interactive infrastructure (§14 Phase 0, §15 criterion 6).

---

## 1. Problem

DD-018 gave source models (STL/3MF) a **static** presentation still — `renderModelStill` produces a
thumbnail/card image. A print-farm or file-manager user with an STL therefore *sees* the part but
**cannot orbit, zoom, or pan it**. The only interactive 3D surface today is the **ToolpathRenderer**,
which consumes sliced G-code (`ToolpathIR`) — it cannot show a source mesh. The result is a product
inconsistency the AnyBridge owner review flagged: "great static thumbnail, but View-in-3D goes dead the
moment the file is a model rather than g-code." Both owners want that gap closed with an **interactive**
analogue of `renderModelStill`.

The hard parts already exist from the DD-018 paint work: a three-free `ModelScene`, the `ModelRenderer`
that builds a lit three.js scene from it (incl. capability-honest colour and production `paint_color`
decode), and the shared render **stage** (framing pose + GL builder) in `@chestnutlabs/gcode-renderer-three`.
The ToolpathRenderer already solved orbit/zoom/pan, camera presets + serializable `CameraState`
(#267/#268), WebGL context-loss recovery, and interaction-aware quality (DD-020). What is missing is the
**interactive shell** that drives a `ModelScene` with those controls — which is largely a matter of
sharing the existing infrastructure, not building it anew.

## 2. Scope

- A **distinct, lower-level interactive viewer handle** — `createModelViewer(canvas, options?)` → a
  `ModelViewer` — for orbit/zoom/pan of a **source model** in the browser. The live analogue of
  `renderModelStill`.
- **STL and 3MF** as the first (and only v1) implemented source formats, reusing the DD-018 loaders
  (`parseStl` / `parse3mf`, including `paint_color` multicolor).
- **A generic model-source input abstraction** so the public API is not shaped to `STL | 3MF` — a
  loader registry keyed by an open `kind` string — leaving a clean path for OBJ/STEP/PLY/other sources
  to register later **without changing the public interface**.
- **Reuse** of the shared stage, the `ModelRenderer` scene/mesh/lighting core, and the toolpath side's
  camera/orbit controls, context-loss recovery, and DD-020 interaction quality — extracting the shared
  interactive pieces into the stage rather than copying them.
- Capability honesty carried through from `ModelScene` (`materials: known | approximated | unavailable`).

## 3. Non-goals

- **Not a mode on `<GcodePreview>`.** That component is built around parse→`ToolpathIR`→toolpath (its
  `source` is g-code); a mesh path would muddy both surfaces. Model interaction and sliced-toolpath
  inspection stay **two different jobs, two different surfaces**.
- **Not toolpath inspection** — no layers, travel, scrub, colour-by-feature, progress. Those are the
  ToolpathRenderer's.
- **Not headless.** Interactive is a browser (windowed) concern; headless/offscreen stills remain
  `renderModelStill` (DD-018 §4.3). The two share the scene core but not the driver.
- **Not implementing OBJ/STEP/PLY now.** v1 ships STL/3MF; the API must merely **not preclude** them.
- **Not** editing, measuring, annotation, sectioning, or slicing tools.
- **Framework components (`<ModelViewer>`) are a later phase**, not v1 (see §14). v1 is the handle.

## 4. Data contracts / API

### 4.1 The generic model-source seam (extensibility without redesign)

```ts
/** A loader turns source bytes of one `kind` into the neutral ModelScene (DD-018 §4.1). */
export interface ModelLoader {
  readonly kind: string; // 'stl' | '3mf' | (future) 'obj' | 'step' | 'ply' | …
  parse(bytes: Uint8Array, limits?: ModelLimits): ModelScene | Promise<ModelScene>;
}

/** The viewer's input: raw bytes tagged by kind, or an already-built scene. `kind` is an OPEN string —
 *  new formats register a ModelLoader; the type is NOT an STL|3MF union. */
export type ModelSourceInput = { kind: string; bytes: Uint8Array | ArrayBuffer } | ModelScene;
```

v1 registers `stlLoader` (`kind:'stl'`) and `threeMfLoader` (`kind:'3mf'`). `renderModelStill`'s existing
`ModelSource` union is refactored to flow through the same registry (backward compatible — see §10).

### 4.2 The viewer handle

```ts
export interface ModelViewerOptions {
  loaders?: ModelLoader[];              // default: [stlLoader, threeMfLoader]
  background?: ModelBackground;         // 'transparent' | CSS colour | 0xRRGGBB (DD-018)
  interactionQuality?: 'off' | 'auto';  // DD-020; default 'auto'
  cameraMode?: 'perspective' | 'orthographic';
  filamentPalette?: readonly (string | undefined)[]; // 3MF paint palette override (parity w/ renderModelStill)
  createRenderer?: (canvas: RenderTargetCanvas) => GLRendererLike; // test/exotic-host injection
}

export interface ModelViewer {
  setSource(input: ModelSourceInput): Promise<ModelReadyInfo>; // parse → build → frame
  setView(view: PresentationView | CameraView): void;          // presets (shared with toolpath)
  getCameraState(): CameraState | null;
  setCameraState(state: CameraState): void;
  setBackground(bg: ModelBackground): void;
  setInteractionQuality(mode: 'off' | 'auto'): void;
  resize(width: number, height: number): void;
  frame(): void;                          // re-fit the camera to the model bounds
  onEvent(cb: (e: ModelViewerEvent) => void): () => void;
  dispose(): void;
}

export interface ModelReadyInfo {
  objectCount: number;
  materials: Confidence;                  // known | approximated | unavailable (never fabricated)
  bounds: ModelBounds;
  // Reserved additive extension (not v1): a per-object parts list —
  //   objects?: { name?: string; materials?: Confidence }[]
  // A multi-object source 3MF could later surface a parts panel. `ModelScene` already carries the
  // per-object data (id/name/geometry/material), so this is a purely additive field — no redesign.
}

export type ModelViewerEvent =
  | { type: 'ready'; info: ModelReadyInfo }
  | { type: 'camera-changed'; state: CameraState }
  | { type: 'error'; code: string; message: string }   // parse/limit/source-kind failures
  | { type: 'renderer-unsupported'; feature: string; message: string } // e.g. no WebGL
  | { type: 'context-lost' } | { type: 'context-restored' };
```

Capability tiers are **passed through** from `ModelScene.capabilities`, not recomputed — the viewer never
claims more than the loader proved (DD-001 honesty; matches `renderModelStill`).

## 5. Lifecycle

- **Create** with a live `<canvas>`; the viewer owns the GL context (built via the shared stage builder),
  an `OrbitControls`-class controller, and a **damage-driven render loop** (renders on change — source
  set, camera moved, resize, context restore — not a free-running rAF; idles when nothing changed and
  when the page/canvas is hidden).
- **`setSource`** is async (3MF unzips via `DecompressionStream`): parse via the matching loader → build
  meshes (reuse `ModelRenderer`'s scene/mesh/lighting core) → replace any prior scene (dispose its
  geometries/materials) → frame → emit `ready`. Overlapping calls: last-wins (stale results discarded).
- **`dispose`** tears down the render loop, controls, GL context, and all scene resources; idempotent.
- **Context loss** is recovered by rebuilding GL + scene from the retained `ModelScene` (reuse the
  renderer-three recovery approach), emitting `context-lost`/`context-restored`.

## 6. Errors & failure behavior

- Loader failures (`ModelParseError` — empty, too-large, too-many-triangles, malformed) surface as an
  `error` event with the structured code, **never thrown out of the render loop**.
- **Unknown `kind`** (no registered loader) → `error` `E_MODEL_UNSUPPORTED_KIND` — honest, actionable.
- **WebGL unavailable / creation fails** → `renderer-unsupported` so the consumer can fall back to a
  `renderModelStill` image or a static thumbnail rather than a blank canvas (parity with the 2D
  renderer's `renderer-unsupported` disclosure, DD-014).
- Honesty tiers unchanged: no palette / no material ⇒ `materials:'unavailable'` neutral render, never a
  fabricated colour.

## 7. Security & resource limits

Reuse DD-018's `ModelLimits` (triangle / source-byte caps, `resolveLimits`) and the hardened, zero-dep
container (ZIP) reader from `@chestnutlabs/gcode-containers` (DD-005 §7 — bomb/traversal/size caps). No
network, ever (no texture/URL fetch). Interactive render cost is bounded by the DD-020 quality policy and
the existing GPU/vertex budget; the damage-driven loop avoids steady-state GPU churn.

## 8. Performance

- **DD-020 interaction-aware quality** applies directly: reduce pixel ratio (and, if useful, a frame-time
  step) while orbiting, restore on settle. Default `'auto'`.
- **Damage-driven rendering** (render only on change) keeps an idle viewer at ~0 GPU load — important when
  a farm UI shows many cards, only one of which is the live viewer.
- Vertex-budget fallback from the renderer stage still applies. Very large meshes (e.g. the 858k-triangle
  Lunarwing) already render in the still; the viewer inherits that plus the quality throttle for orbit.

## 9. Testing

- **Headless-shaped unit tests** with an injected `GLRendererLike` and injectable controls/scheduler
  (the pattern the `ModelRenderer` and toolpath renderer tests already use): source set → `ready` with
  correct `objectCount`/`materials`/`bounds`; unknown-kind → `error`; dispose idempotency; last-wins
  `setSource`; capability pass-through (STL neutral, colour-3MF known, subdivided → approximated).
- **Loader-registry test**: registering a stub loader for a new `kind` makes it viewable with **no API
  change** — the extensibility guarantee.
- **Demo harness page** (an interactive sibling of `tools/demo/model.html`) for manual/visual + a
  documentation capture, driving a synthetic MIT-clean model.

## 10. Migration

Additive. New exports; no breaking change. `renderModelStill` keeps its signature and behavior; its
internal `ModelSource` dispatch is refactored onto the shared loader registry (the existing
`{kind:'stl'} | {kind:'3mf'} | ModelScene` union stays valid input). No IR, package-topology-breaking, or
adapter changes required for the v1 handle.

## 11. Observability / diagnostics

Events (`ready` with the capability tier, `camera-changed`, `error` with structured codes,
`context-lost/restored`, `renderer-unsupported`). The `materials` tier on `ready` is the honest signal a
consumer surfaces ("true colours" vs "neutral — this file carries no colour").

## 12. Alternatives considered

- **A `mode:'model'` on `<GcodePreview>`** — rejected. The g-code component is parse→toolpath shaped;
  overloading it couples two unrelated jobs and confuses the `source` contract. A distinct surface is
  cleaner (owner-endorsed).
- **`ModelSource = {kind:'stl'} | {kind:'3mf'}` union at the public boundary** — rejected. It bakes the
  first two formats into the API and would force a breaking change to add OBJ/STEP/PLY. The open-`kind`
  **loader registry** keeps the boundary generic (owner constraint).
- **Duplicating the camera/orbit/quality code in the viewer** — rejected in favour of **extracting the
  shared interactive-viewer infrastructure into the stage** (`@chestnutlabs/gcode-renderer-three`), used
  by both the toolpath renderer and the model viewer. Avoids a parallel copy drifting out of sync.
- **A new package for the viewer** — rejected. `createModelViewer` belongs in the existing
  `@chestnutlabs/gcode-model-renderer` (it already owns `ModelScene` building and depends on the stage);
  the shared-control extraction lands in `gcode-renderer-three`. No new lockstep package.
- **Coupling `renderModelStill` and the viewer** (one class does both) — rejected. Both compose the same
  `ModelRenderer` scene/mesh/lighting **core**; the still adds "render once + cache key", the viewer adds
  "controls + damage loop". Neither depends on the other.

## 13. Risks

- **Shared-stage extraction scope creep** — refactoring the toolpath renderer's camera/controls into the
  stage risks touching a mature, load-bearing surface. Mitigate: extract the **minimum** shared surface,
  keep the toolpath renderer behavior byte-for-byte, gate Phase 0 behind its existing tests.
- **`three` OrbitControls / camera coupling** — keep controls behind the stage's injectable seam so tests
  stay headless and the `three` version stays pinned (DD-008 posture).
- **Consumer expectation drift** — a viewer implies richer UX (measure, section) users may ask for;
  §3 fences v1 firmly.

## 14. Phased delivery

- **Phase 0 — shared interactive infrastructure.** Extract camera/orbit/pan controls, context-loss
  recovery, and the damage-driven render-loop scheduler into the shared stage (or a shared module in
  `gcode-renderer-three`), consumed by the existing toolpath renderer **without behavior change** (its
  tests are the gate). No public API change.
- **Phase 1 — `createModelViewer` handle (STL + 3MF).** The `ModelViewer` per §4 on the shared infra +
  the `ModelRenderer` scene core: orbit/zoom/pan, presets + `CameraState`, `interactionQuality`, generic
  loader registry (stl + 3mf registered), lifecycle/disposal, honesty pass-through, events. Unit tests +
  interactive demo harness. **This is the v1 deliverable.**
- **Phase 2 (follow-on, optional) — framework components.** Thin `<ModelViewer>` wrappers (Vue/React/
  Svelte/Element) analogous to `<GcodePreview>` but model-mode, over the shared behavioral-test pattern —
  only if the product wants drop-in components. Not required for handle-level consumption: the early
  consumer (AnyBridge) wraps the handle directly in v1 (create-on-mount → `setSource` → `onEvent` →
  reactive state → `ResizeObserver`→`resize` → `dispose`-on-unmount). A Phase-2 component is pulled
  forward only if that boilerplate is duplicated across enough consumers to warrant it.
- **Later (out of this DD) — additional source formats.** OBJ/STEP/PLY register `ModelLoader`s into the
  seam; no public-API change. Each is its own small unit of work, gated on its own licensing/parse review.

## 15. Acceptance criteria

1. `createModelViewer(canvas)` interactively orbits/zooms/pans a real **STL** and a real **3MF** (incl. a
   `paint_color` multicolor file rendering in true colours), in a browser.
2. The public input is a **generic model source** (open `kind` + loader registry); a test proves a new
   `kind` becomes viewable by **registering a loader only**, with no change to `ModelViewer` /
   `createModelViewer` signatures.
3. The viewer is a **distinct surface** from `ToolpathRenderer` and `<GcodePreview>`; no toolpath concepts
   leak in.
4. Capability honesty is preserved end-to-end (`materials` known/approximated/unavailable on `ready`;
   neutral render + `unavailable` when no colour is present).
5. `renderModelStill` is unchanged in signature and output; both compose the shared `ModelRenderer` core.
6. Phase 0 leaves the toolpath renderer's behavior and tests unchanged.
7. Unit tests (headless, injected GL) green; interactive demo harness renders and orbits a synthetic
   MIT-clean model.
