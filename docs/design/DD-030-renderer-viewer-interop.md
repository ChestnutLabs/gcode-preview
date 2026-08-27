# DD-030 — Renderer/viewer interoperability: capture(), per-plate render scope & custom bed geometry

**Status:** **Accepted** — capabilities and the public-API shape approved by the maintainer 2026-08-27
(the four §7 open questions resolved in the decision log). Implementation proceeds in the §4.5 sequence
(bed → render scope → capture); the accepted shape is the contract.
<!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (drafted by Claude, project lead)
**Date:** 2026-08-27
**Owning Epic:** renderer/viewer consumer-interoperability (consumer-driven; AnyBridge is the first
consumer) · **Milestone:** next lockstep minor
**Related:** [DD-018](./DD-018-model-renderer.md) (ModelRenderer / model presentation surface),
[DD-025](./DD-025-multi-plate-model-structure.md) (multi-plate model structure — the data this activates),
[DD-023](./DD-023-capability-aware-render-budget.md) (capability-aware render budget — capture reflects
current live fidelity),
DD-001 (capability/confidence honesty model), DD-005 (adapter contracts — the 4 framework adapters over
one controller). Reference: the still-render readback path (`render-still.ts`, `render-model-still.ts`).

---

> **Why now.** Three distinct consumers need to drive the renderer in ways the current public surface does
> not allow, and they are all **generic renderer/viewer primitives** — not one application's needs. A
> partner integration (AnyBridge) surfaced concrete use-cases for each, but the capabilities are written
> to serve any consumer that needs the *currently displayed view as an image*, a *specific plate of a
> multi-plate source*, or an *honest non-rectangular bed*. Two adjacent things already work and are
> **out of scope**: sliced-gcode variant thumbnails (`renderStill` already renders a parsed toolpath) and
> rectangular bed dimensions + texture (`BuildVolumeDef` + `BedSurface` already do this). One thing was
> investigated and found to have **no substrate** — overhang/support-need visualization — and is
> deliberately deferred to its own future capability (there is no geometry/normal-analysis layer to build
> it on today).

## 1. Problem

The engine renders well but cannot yet be *driven* by a consumer for three common integration needs:

1. **No image capture from the live viewer.** The interactive stage exposes `render()`, camera state, and
   framing, but **no readback** — a consumer cannot turn "what the operator is looking at right now" into
   a `Blob`/image. The headless `renderStill`/`renderModelStill` path *does* produce a readable canvas
   (it forces `preserveDrawingBuffer: true`, renders once, and hands the caller the canvas to extract
   pixels), but there is no equivalent for the **interactive** view, and the interactive context defaults
   `preserveDrawingBuffer: false` (deliberately, for interaction perf), so an out-of-band `toBlob()` on
   the live canvas returns a blank frame.

2. **No per-plate render isolation.** DD-025 parses multi-plate project 3MFs and already exposes
   `ModelScene.plates` (per-plate summaries **with bounds**) and per-placement `ModelObject.plateIds[]` —
   but the model renderer always renders and frames the **whole** project. A consumer cannot render "just
   plate 3" of a 6-plate tray. The structural data exists; the render-time selector does not.

3. **No non-rectangular bed.** `BuildVolumeDef` is rectangular-only (`x`/`y`/`z` + corner origin). A
   delta, round, or otherwise irregular machine bed cannot be drawn honestly; worse, `machineToVolume()`
   currently *discards* a discovered circular/polygon bed into its bounding rectangle, so even
   already-detected non-rect beds render as a wrong rectangle.

All three are **additive** — no existing behavior is removed — but each adds public surface, so the shape
is worth agreeing before it ships and becomes a contract across 13 lockstep packages + 4 adapters.

## 2. Scope

Three capabilities, each a generic primitive:

1. **`capture()` → `Blob`** on the interactive viewer(s): return the currently-displayed view as an image.
2. **Per-plate render scope**: render/frame a caller-selected subset (a plate, or any object subset) of a
   multi-plate/multi-object **model** source.
3. **Custom bed geometry**: draw an honest non-rectangular bed (delta/round/irregular) from a
   caller-supplied outline (or, as a reserved escape hatch, a caller-supplied mesh).

## 3. Non-goals

- **Overhang / support-need visualization** — deferred. There is no face-normal / slope / downward-facing
  analysis substrate anywhere in the repo (the only "overhang" strings are slicer feature-role *labels*).
  A genuine "these areas may need support" preflight is a new geometry-analysis capability that needs its
  own investigation/DD and a real consumer need; it is explicitly **not** part of this batch.
- **Sliced-gcode (variant) thumbnails** — already shipped: `renderStill(source)` renders a parsed
  `ToolpathIR` or raw G-code. A single-plate *variant* is already its own single-plate gcode (toolpath
  plate isolation happens at **parse time** via `WireParseOptions.plate`), so its thumbnail needs no new
  API. This DD adds **no toolpath render scope** (§4.2 D2 explains the parity).
- **Rectangular bed dimensions + texture** — already shipped (`BuildVolumeDef` + `BedSurface`). §4.3 only
  *extends* the shape abstraction; the rectangular path stays byte-identical.
- **Machine-profile parsing.** The renderer draws whatever shape/mesh the caller hands it. No printer
  database, no OrcaSlicer/vendor semantics in the renderer API — discovery lives in the parser/dialects
  layer (`MachineGeometry`) and only *feeds* the renderer.
- **Downloading/saving images.** `capture()` returns a `Blob` to the consumer; the library never triggers
  a download (same "caller owns the pixels" contract as the still path).

## 4. Decisions

### 4.1 D1 — Interactive `capture()` → Blob

**Where it lives (three additive layers):**

- **Real implementation on the interactive stage** (`InteractiveStage`), which owns the GL context and
  canvas.
- **Thin delegators** on `ToolpathRenderer` and on the model surface (`ModelRenderer` / `ModelViewer`).
- **`GcodePreviewControls.capture(opts?)`** on the controller, routed through the neutral `PreviewRenderer`
  seam — this is what threads to **all four framework adapters for free** (they pass `controls` straight
  through; the Web Component adds one imperative method).

**Signature (generic, vendor-neutral):**

```ts
export interface CaptureOptions {
  width?: number;   // default: current drawing-buffer size
  height?: number;
  format?: 'image/png' | 'image/jpeg' | 'image/webp'; // default 'image/png'
  quality?: number; // 0..1 for lossy formats
  background?: 'transparent' | ThemeColor; // default: current scene background
}
capture(opts?: CaptureOptions): Promise<Blob>;
```

**Mechanism — render-to-target (recommended).** The core design tension is that the interactive context
defaults `preserveDrawingBuffer: false`. Rather than flip that default (which taxes every interactive
frame for the whole session — the documented reason it is off), `capture()` renders the current scene +
active camera **into an off-screen `WebGLRenderTarget`** sized to `opts.width/height`, then `readPixels`
into a canvas and `convertToBlob()`. This gives (a) arbitrary output size (a 2048px thumbnail from a
400px viewport), (b) an independent/transparent background without disturbing the live view, and (c) full
decoupling from `preserveDrawingBuffer`. It literally re-runs a still-style single render off to the side,
so it reuses the **visual family** of the headless still path. A fast path (direct `readPixels` after a
synchronous `render()`) may be used when `width/height` match the viewport and no custom background is
requested; it is a pure optimization, not the contract.

- **Rejected — flip the interactive `preserveDrawingBuffer` to true** (a `capturable` construction flag).
  Simplest, but taxes every interactive frame for the session; only justified for continuous capture,
  which no consumer needs.
- **Rejected — leave capture to the consumer via `raw.renderer()`.** Pushes GL readback, row-flip, and
  the preserve-buffer problem onto every consumer; defeats the "one controller, adapters inherit" model.

**Honesty note.** Capture reflects the **current live fidelity** (which already ran under the DD-023
capability-aware render budget) — unlike `renderStill`, which builds fresh. AA/pose differences mean capture pixels
are not byte-identical to a `renderStill` of the same pose (already disclaimed for stills). No
capability-tier change: capture is a mechanical readback and asserts nothing about the source.

### 4.2 D2 — Per-plate render scope (model side)

**Generalize "plate" to an object-subset filter** — plate is one derivation of the subset, which keeps
the API vendor-neutral and also serves non-plate consumers (isolate one object for a detail card):

```ts
export type RenderScope =
  | { objectIds: string[] }        // ModelObject.id subset
  | { plateId: number }            // sugar: derive the subset from ModelObject.plateIds
  | { instanceFilter: (objectId: string, placementIndex: number) => boolean }; // fully general
```

**Where it applies:**

- `renderModelStill`: add `renderScope?: RenderScope` to `RenderModelStillOptions`; resolve to a filtered
  `ModelScene` before `setScene`; **fold `renderScope` into the still cache key** so plate-1 and plate-2
  thumbnails cache distinctly.
- `createModelViewer`: add `setRenderScope(scope | null)` to the `ModelViewer` handle (and an initial
  option); `null` = whole project (today's behavior).
- The filter itself is a pure, three-free transform on `ModelScene` (drop non-matching objects; drop
  non-matching placements from `instances`/`plateIds`, which are already index-aligned per DD-025).

**Framing** reuses `ModelPlateSummary.bounds` for `{plateId}` (already computed) and the union AABB of the
filtered placements for an arbitrary subset — fed to the existing framing path.

**Honesty.** `{plateId}` is meaningful only when `capabilities.plates === 'known'` (DD-025). When plates
are `unavailable`, resolving `{plateId}` yields an empty scene → emit a disclosure (a
`renderer-unsupported`-style signal), never silently render nothing. An `objectIds`/`instanceFilter` scope
needs no capability (ids are always known).

**Toolpath parity — no toolpath render scope.** Toolpath plates are already isolated at **parse time**
(`WireParseOptions.plate: N` — one plate parsed, never merged), so a variant thumbnail is `renderStill`
of that already-single-plate gcode. Adding a toolpath render scope would duplicate that. The DD records
the parity: **model = render-scope filter; toolpath = re-parse.** (A future sub-object toolpath scope, if
ever needed, would ride DD-026's object/feature membership channel — out of scope here.)

### 4.3 D3 — Custom bed geometry

**Minimal honest primitive: a 2D outline polygon the renderer fills/extrudes.** Extend `BuildVolumeDef`
additively:

```ts
export interface BuildVolumeDef {
  x: number; y: number; z: number;      // KEEP — bounding size (cage height, camera framing)
  grid?: number;
  min?: { x: number; y: number };
  excludedRegions?: Region2[];
  shape?: BedShape;                      // NEW — omit ⇒ rectangular [min .. min+size] (today, byte-identical)
}

export type BedShape =
  | { kind: 'rect' }                                                     // explicit default
  | { kind: 'circular'; center: { x: number; y: number }; diameter: number }
  | { kind: 'polygon'; points: { x: number; y: number }[] }             // delta / irregular / any loop
  | { kind: 'mesh'; geometry: MeshOutline };                            // reserved escape hatch (Phase 2)
```

- **Delta / round / irregular all reduce to `polygon`** (a circle is a polygonized loop; a delta is a
  rounded triangle). The renderer fills the polygon (a `ShapeGeometry` instead of `PlaneGeometry`) and
  draws its outline — reusing machinery that already exists (`Region2` polygons + the `excludedRegion`
  polygon-outline renderer). **Ship `polygon` + `circular` first**; treat `{kind:'mesh'}` (a caller-
  supplied bed mesh, three-free flat `positions`/`indices`) as a reserved later field — rarely needed,
  more surface.
- **`machineToVolume()` upgrade:** today it collapses a discovered `circular`/`polygon` `MachineGeometry.bed`
  into a bounding rect; make it populate `shape`. This makes discovered round/delta beds render honestly
  **with no new consumer code** — but it is a **visible behavior change** for already-discovered non-rect
  beds (they render as a circle/polygon instead of a bounding box). Gate it on the field's presence /
  regenerate visual baselines deliberately and note it in release notes (§4.4).
- **Grid on a non-rect bed:** clip the existing rectangular grid to the polygon (the grid represents the
  printable area). Origin tripod unchanged; the cage may stay a bounding box (gated by `showCage`) or
  become a polygon prism — cosmetic, decide at implementation.

**Vendor-neutrality:** the caller supplies the shape (from wherever — an Orca profile, a config, a
hard-coded delta); the renderer is a dumb draw-the-polygon consumer. No profile parsing in the library.

### 4.4 D4 — Versioning, compatibility & honesty

- **All three are additive** (new optional fields/methods) → the whole batch is **one lockstep minor**
  (no majors). The four adapters inherit `capture()` via the existing `controls` passthrough; the model
  viewer is a separate surface versioned in the same bump.
- **`PreviewRenderer` interface** gains an optional `capture?` member (2D renderer honestly returns a
  `renderer-unsupported`-style rejection) — a coordinated in-repo change, not a consumer break.
- **The one behavioral watch-item** is the bed: `createBuildVolume` internals change (grid clip,
  `ShapeGeometry` fill), which must stay byte-identical when `shape` is absent/`'rect'` (verify against
  the rectangular-bed visual baselines), and the `machineToVolume` change alters output for discovered
  non-rect beds — an intended improvement that needs a deliberate golden/screenshot regen (docs-freshness
  release gate).
- **Honesty model:** capture adds no tier; render-scope ties to the existing `plates` tier; bed may
  surface a "bed shape approximated as bounding rect" disclosure when only a bbox is available
  (`known`/`inferred`/`approximated`/`unavailable`, per DD-001). No new IR shape.
- **Worker/OffscreenCanvas/SSR:** capture's render-to-target and the scene-filter are OffscreenCanvas-safe
  and three-free respectively; bed textures/meshes stay CSP-safe (`ImageBitmap`/typed arrays, never URLs).
  Nothing runs at SSR time (all are runtime calls on a live/headless context).

### 4.5 D5 — Sequencing (dependency-ordered)

The three are largely independent (different files/packages). An optional **shared readback helper**
(render-scene-to-Blob) can de-duplicate the pixel readback across the toolpath still, the model still, and
interactive capture — extract it with (or just before) capture.

1. **Bed geometry — Phase 1 (`polygon`/`circular` outline).** Self-contained in `gcode-renderer-three`
   (build-volume + theme + `machineToVolume`); no cross-package or adapter change. Lowest risk except the
   golden regen. Defer `{kind:'mesh'}`.
2. **Render scope — model side.** Self-contained in `gcode-model-renderer` (scene filter + still option +
   `ModelViewer.setRenderScope` + cache key). Builds directly on DD-025 data already present. No adapter
   change (model viewer is its own surface).
3. **`capture()` — last (widest surface).** Stage/renderer implementation + render-to-target first, then
   thread onto `GcodePreviewControls` (adapters inherit free) + the Web Component method + `ModelViewer`.

This ordering matches the consumer's stated priority for *consumption* (plate → capture → bed) closely
enough; the two lowest-risk, self-contained pieces (bed, plate) land first, and the highest-fan-out piece
(capture) lands once the pattern is proven. Each is independently landable and independently valuable.

## 5. Consumer use-cases (evidence)

Recorded from the first consumer (AnyBridge) so the shapes are grounded, not speculative:

- **Per-plate (priority 1):** a single-plate *variant* of a multi-plate project must visually represent
  *that* plate (plate 3 of a 6-plate set looks like plate 3, not the whole tray); the source drawer wants
  per-plate previews. Consumes `RenderScope {plateId}` on `renderModelStill`/`ModelViewer`. (An embedded
  `plate_N.png` covers the cheap case consumer-side meanwhile.)
- **`capture()` (priority 2):** (a) an operator frames the model in the live 3D view and snapshots it as
  the file thumbnail (a built, capability-gated consumer feature waits only on this); (b) a large-file
  thumbnail fallback — a >200 MB STL the server can't render but a client GPU renders fine. Consumes
  `capture(opts?) → Blob`.
- **Non-rect bed (priority 3):** draw the real bed of the sliced-for printer (delta/round/arbitrary
  outline) from the machine profile's bed data. Consumer passes dims/shape/texture; renderer draws the
  polygon.

## 6. Alternatives considered

- **Ship each capability piecemeal / consumer-specific.** Rejected by the maintainer: design the three as
  one coherent, generic surface, no consumer semantics baked in.
- **Plate-primitive instead of a general subset filter.** Rejected: a general `RenderScope` (with
  `plateId` sugar) stays vendor-neutral and serves non-plate consumers at no extra cost.
- **Arbitrary caller mesh as the primary bed API.** Rejected as the *first* increment: a 2D outline
  polygon is the minimal honest primitive that covers delta/round/irregular; the mesh escape hatch is a
  reserved later field.
- **Overhang/support viz in this batch.** Rejected: no analysis substrate exists; it is a separate future
  capability with its own DD.

## 7. Open questions (resolved at acceptance — see the decision log)

1. **capture() output ergonomics** → **`Blob`-only** for now (covers every stated use-case: thumbnail
   POST, large-file fallback). `captureToCanvas()` is a trivial additive follow-up if a consumer needs
   raw pixels; not shipped in the first cut to keep the surface minimal.
2. **Bed cage on a non-rect bed** → **keep the bounding-box cage** (gated by `showCage`). The bed
   *outline* carries the honesty; a polygon prism is cosmetic and can come later.
3. **`machineToVolume` behavior change** → **default** (render a discovered non-rect bed as its true
   outline — the honest result) **with a deliberate visual-baseline + screenshot regen and a release
   note**. The rectangular path stays byte-identical; only already-wrong bounding-rect renders change.
4. **`{kind:'mesh'}` bed** → **omit for now** (YAGNI). Ship `polygon` + `circular`; reserve `mesh` in the
   DD as the escape hatch, add the field only when a real consumer needs an arbitrary bed mesh.

## 8. Acceptance criteria

- [ ] D1–D5 reviewed; the public-surface shape signed off by the maintainer; DD marked Accepted.
- [ ] `capture()` returns a correct `Blob` from the interactive toolpath viewer and the model viewer, at
      the viewport size and at an arbitrary requested size, with transparent and themed backgrounds,
      **without** changing the interactive `preserveDrawingBuffer` default; available on all 4 adapters.
- [ ] `renderModelStill`/`ModelViewer` render and frame a selected plate (and an arbitrary object subset);
      the still cache keys distinctly per scope; `{plateId}` on a `plates: unavailable` source discloses.
- [ ] A delta/round/irregular bed renders as its true outline; discovered non-rect beds no longer collapse
      to a bounding rect; the rectangular-bed path stays byte-identical (visual baselines).
- [ ] Additive only — one lockstep minor; no IR shape change; honesty tiers preserved; docs/screenshots
      regenerated where bed rendering visibly changed.

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-08-27 | The three capabilities (interactive `capture()`, per-plate render scope, non-rectangular bed geometry) **product-approved** as one generic renderer/viewer interoperability batch — design together, keep vendor-neutral, no consumer semantics in the API. Overhang/support-need viz explicitly **deferred** (no analysis substrate; needs its own DD). Sliced-gcode variant thumbnails + rectangular bed/texture confirmed already-shipped and **out of scope**. | Chestnut Labs (maintainer) |
| 2026-08-27 | DD-030 drafted **Proposed** with the concrete API shapes (D1 render-to-target `capture()` on `GcodePreviewControls` + `ModelViewer`; D2 generic `RenderScope` model-side with `{plateId}` sugar, toolpath stays parse-time; D3 `BedShape` polygon primitive + `machineToVolume` upgrade, `mesh` reserved). Brought for public-surface sign-off before implementation. | Chestnut Labs (lead) |
| 2026-08-27 | **API shape accepted** by the maintainer. §7 open questions resolved: (1) `capture()` **`Blob`-only** first (`captureToCanvas()` deferred as a trivial follow-up); (2) **bounding-box cage** kept on non-rect beds (the outline carries honesty); (3) `machineToVolume` renders discovered non-rect beds honestly **by default** with a deliberate visual-baseline + screenshot regen and a release note (rectangular path byte-identical); (4) `{kind:'mesh'}` **omitted** for now (reserved in the DD; `polygon`+`circular` ship). Implementation authorized in the §4.5 sequence: bed → render scope → capture, each an independently-reviewable increment; flag the consumer with the version target on each landing. | Chestnut Labs (maintainer + lead) |
