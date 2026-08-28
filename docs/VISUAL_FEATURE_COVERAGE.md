# Visual Feature Coverage Matrix

**Purpose.** A persistent, maintained inventory of every user-facing capability G-code Preview
ships, and how well each is *communicated* — demonstrated in the demo, shown in media, and
documented across the README, the GitHub Pages feature gallery, and the manual/package docs.

This file is a **release artifact**, not a one-time audit. The release process
([`docs/reference/release-process.md`](reference/release-process.md)) requires the Public Product +
Documentation + Visual Review to reconcile this matrix against what actually shipped, so no
capability silently loses coverage. See
[Maintaining this matrix](#maintaining-this-matrix-release-integration) at the bottom.

> **Scope.** "User-facing" = something a consumer of the packages can see, control, inspect,
> configure, or must understand to use the library. Internal architecture, build tooling, and test
> harnesses are out of scope except where they surface a consumer-visible behavior.

## Status vocabulary

| Status | Meaning |
|---|---|
| `covered` | Demonstrated and documented adequately; a current visual explains it where visual. |
| `needs screenshot` | Real capability, no image yet — a static shot would materially help. |
| `needs better coverage` | Has an image, but it under-explains the feature (see the §8 test below). |
| `needs comparison` | Best shown as before/after or A-vs-B, not a single frame. |
| `needs animation` | The interaction *is* the feature; a static frame can't carry it. |
| `needs demo exposure` | Not reachable/observable in the shipped showcase demo. |
| `not visually meaningful` | Genuinely non-visual; documented by code/table/prose instead. |
| `internal-only` | Not consumer-facing; here only to record the decision to exclude it. |

The **§8 test** (from [`USER_FACING_DOCS_STYLE.md`](USER_FACING_DOCS_STYLE.md)): *if a developer saw
this image with no caption, would they have a reasonable chance of noticing which feature it
demonstrates?* If not, the visual is `needs better coverage` no matter how pretty it is.

## Two visual classes

- **Showcase** — clean, immediately legible, carefully framed. Used in the README, the Pages
  homepage, and major landing sections.
- **Feature-proof** — intentionally shows controls, toggles, legends, values, selected states,
  diagnostics, warnings, confidence tiers, and before/after comparisons. Used in the Pages feature
  gallery, manual concept pages, and recipes. Completeness over beauty.

Both are captured on the shared **mid-grey documentation presentation**
(`tools/screenshots/`) — a neutral slicer/CAD-style viewport, not the demo's incidental dark UI.
Intentional exceptions (transparency, dark/light themes, custom backgrounds) are noted per-row.

---

## 1. Toolpath inspection

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Layer-range clipping | ✅ | ✅ | `layer-clip-benchy` | ✅ | gallery | recipes | needs better coverage — show the range control + resulting cut |
| Segment scrub | ✅ | ✅ | — | — | gallery | recipes | needs animation — scrub is temporal |
| Time scrub + print-time estimate (slicer vs kinematic provenance) | ✅ | ✅ | — | mention | gallery | concept-progress-motion | needs animation + needs better coverage (provenance label) |
| Travel-move toggle | ✅ | ✅ | (in others) | ✅ | gallery | recipes | covered |
| Wipe-move toggle | ✅ | ✅ | — | mention | gallery | — | needs screenshot |
| Retraction / de-retraction markers | ✅ | ✅ | `retraction-markers` | ✅ | gallery | — | covered |
| Seam moves | ✅ | partial | — | mention | gallery | — | needs screenshot |
| Source-line ↔ segment mapping ("debugger": `pickSegment` + `segmentAtSourceLine`) | ✅ | ❌ | — | ❌ | gallery | recipes | needs demo exposure + needs screenshot |

## 2. Coloring & analysis modes

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Color by feature role | ✅ | ✅ | `viewer-benchy-tubes` (hero) | ✅ | gallery | concept-ir-capabilities | needs better coverage — add a legend |
| Color by speed / feedrate | ✅ | driven | `color-speed-calicat` | ✅ | gallery | — | needs better coverage — add ramp legend |
| Color by layer height | ✅ | ✅ | `color-layerheight` | ✅ | gallery | — | covered |
| Color by object | ✅ | driven | — | ❌ | gallery | — | needs screenshot |
| Color by tool | ✅ | ✅ | — | mention | gallery | — | needs screenshot |
| Color by M600 color change | ✅ | ✅ | — | mention | gallery | — | needs screenshot |
| Color by filament (file's own colours) | ✅ | driven | — | ❌ | gallery | concept-dialects-containers | needs screenshot |
| Color by tool power (laser/spindle) | ✅ | validate page | — | mention | gallery (CNC) | — | needs demo exposure + needs screenshot |
| Color by cut-vs-rapid (move kind) | ✅ | validate page | `cnc-cut-vs-rapid` | ✅ | gallery (CNC) | — | needs better coverage — legend + context |

## 3. Live job progress

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Known (byte-exact) position | ✅ | ✅ | `progress-known` | ✅ | gallery | concept-progress-motion | covered |
| Approximated position (uncertainty band) | ✅ | ✅ | `progress-approximated` | ✅ | gallery | concept-progress-motion | covered (pair reads as comparison) |
| Stale-signal greying | ✅ | ✅ | — | mention | gallery | concept-progress-motion | needs comparison (fresh vs stale) |
| File-identity mismatch detection | ✅ | ✅ | — | ❌ | — | reference/progress-* | not visually meaningful (prose + code) |
| User-scrub-wins over telemetry | ✅ | ✅ | — | mention | gallery | reference/progress-consumer-notes | needs animation |

## 4. Rendering & quality

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Tube geometry | ✅ | ✅ | hero | ✅ | gallery | concept-workers | covered |
| Line geometry | ✅ | ✅ | — | mention | gallery | — | needs comparison (tubes vs lines) |
| Canvas 2D fallback (no WebGL/Three) | ✅ | 2d page | `canvas-2d-fallback` | ✅ | gallery | concept-workers | covered |
| Quality modes (full/adaptive/fast) | ✅ | partial | — | mention | gallery | concept-workers | needs demo exposure |
| Progressive preview (`auto`/`lines`) | ✅ | wired, no UI | — | ❌ | gallery | concept-workers | needs demo exposure + needs animation |
| Held / single clean reveal (`hold`) | ✅ | ❌ | — | ❌ | gallery | concept-workers | needs demo exposure + needs animation |
| Renderer build stages (`stage` event) | ✅ | ❌ | — | ❌ | gallery | concept-workers | needs demo exposure + needs animation |
| Interaction-aware quality | ✅ | ❌ | — | ✅ (prose) | gallery | concept-workers | needs demo exposure + needs animation |
| Disclosed decimation / degradation | ✅ | partial | — | ✅ (prose) | gallery | concept-workers | needs screenshot (disclosure text) |
| Render diagnostics (`getRenderStats`) | ✅ | ❌ | — | ❌ | gallery | concept-workers | needs demo exposure + needs screenshot |
| Geometry worker pool (parallel tubes) | ✅ | ❌ | — | mention | gallery | concept-workers | not visually meaningful (diagnostics panel proxies it) |
| WebGL context-loss recovery | ✅ | ❌ | — | mention | — | — | not visually meaningful |

## 5. Cameras & presentation

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Camera presets (7 views) | ✅ | ✅ | `camera-top/front/iso` | ✅ | gallery | — | covered (labeled sequence) |
| Perspective vs orthographic | ✅ | ✅ | (in camera trio) | ✅ | gallery | — | covered |
| Saved/restored camera state | ✅ | ✅ | — | mention | — | recipes | not visually meaningful |
| Object-aware framing (`frameContent`) | ✅ | ✅ | — | ✅ (prose) | gallery | concept-ir-capabilities | needs comparison — whole-job vs model-aware |
| Build-volume cage toggle | ✅ | ✅ | — | mention | gallery | — | needs screenshot |
| Capture / export → Blob | ✅ | ❌ | — | ❌ | gallery | recipes | needs demo exposure + needs screenshot |
| Transparent / independent-background capture | ✅ | ❌ | — | ❌ | gallery | recipes | needs demo exposure + needs screenshot (checkerboard) |

## 6. Source-model rendering (STL / 3MF)

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Toolpath vs source-model (two renderers) | ✅ | model page | `model-render-stl-3mf` | ✅ | gallery | — | covered |
| STL presentation still | ✅ | model page | (in pair) | ✅ | gallery | model-renderer README | covered |
| 3MF material/color presentation | ✅ | model page | (in pair) | ✅ | gallery | model-renderer README | covered |
| Interactive model viewer (`createModelViewer`) | ✅ | model-viewer page | — | ✅ (prose) | gallery | model-renderer README | needs demo exposure (link) + needs animation |
| Multi-object files | ✅ | model page | — | mention | gallery | — | needs screenshot |
| Multi-plate files + per-plate render | ✅ | ❌ | — | ❌ | gallery | — | needs demo exposure + needs comparison |
| Render scope / object subsets (`RenderScope`) | ✅ | ❌ | — | ❌ | gallery | recipes | needs demo exposure + needs comparison |
| Instance-aware rendering ("N copies") | ✅ | ❌ | — | ❌ | — | — | needs screenshot (badge) |

## 7. Machine / build geometry

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Rectangular bed | ✅ | ✅ | (in many) | mention | gallery | — | covered |
| Circular / delta bed | ✅ | ❌ | — | ❌ | gallery | concept-dialects-containers | needs demo exposure + needs screenshot |
| Polygonal bed | ✅ | ❌ | — | ❌ | gallery | concept-dialects-containers | needs demo exposure + needs screenshot |
| Excluded-region outlines | ✅ | ✅ | — | ❌ | — | — | needs screenshot |
| Bed surface / texture themes | ✅ | ✅ | — | mention | gallery | — | needs screenshot |

## 8. CNC / laser / plotter

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Cut vs rapid classification | ✅ | validate page | `cnc-cut-vs-rapid` | ✅ | gallery (CNC) | motion-coverage | needs better coverage (legend/context) |
| Tool power channel (laser/RPM) | ✅ | validate page | — | mention | gallery (CNC) | — | needs demo exposure + needs screenshot |
| Canned drilling cycles (G81/82/83) | ✅ | ❌ | — | mention | gallery (CNC) | motion-coverage | needs screenshot |
| Validation tiers (validated vs experimental) | ✅ | validate page | — | ✅ (prose) | gallery (CNC) | compatibility | not visually meaningful (prose/table) |
| Parametric RS274NGC programs (params/expr/O-word/subs) | ✅ | ❌ | — | ❌ | gallery (CNC) | concept-parametric-programs | needs demo exposure + needs comparison (program → geometry) |

## 9. Formats, dialects & classification

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `.gcode` plain | ✅ | ✅ | (all) | ✅ | — | concept-dialects-containers | covered (table) |
| `.gcode.3mf` container + multi-plate | ✅ | ✅ | — | ✅ | gallery | concept-dialects-containers | needs screenshot |
| `.bgcode` (Prusa binary) | ✅ | ❌ | — | ✅ | — | concept-dialects-containers | not visually meaningful (table) |
| Slicer/controller recognition | ✅ | ✅ | — | ✅ | — | compatibility | not visually meaningful (table) |
| Object / feature classification (model vs housekeeping) | ✅ | ❌ | — | mention | gallery | concept-ir-capabilities | needs demo exposure + needs comparison |
| Slice metadata panel (filament, usage, estimate, thumbnails) | ✅ | ✅ | — | mention | gallery | concept-dialects-containers | needs screenshot |
| Capability / confidence model | ✅ | ✅ | — | ✅ (table) | gallery | concept-ir-capabilities | needs screenshot (honest-fallback UI) |

## 10. Framework integration & headless

| Capability | User-facing | Demo | Media | README | Pages gallery | Manual/pkg | Status |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| Vue / React / Svelte / Web Component adapters | ✅ | examples | — | ✅ (table) | — | adapters | not visually meaningful (code) |
| Headless toolpath still (`renderStill`) | ✅ | still page | — | ✅ | gallery | reference/still-render | needs screenshot (server-thumbnail context) |
| Headless model still (`renderModelStill`) | ✅ | model page | `model-render-stl-3mf` | ✅ | gallery | model-renderer README | covered |
| Off-thread parsing / cancellation / limits | ✅ | ✅ | — | ✅ (prose) | — | concept-workers | not visually meaningful |

---

## Media asset inventory

Canonical assets live in [`docs/media/`](media/) and are produced by
[`tools/screenshots/`](../tools/screenshots/README.md) from real renders of the tracked MIT corpus —
nothing mocked or hand-edited. Every asset is enumerated in the shot manifest
(`tools/screenshots/shots.manifest.json`) with its source file, parameters, output class, caption,
and alt text. Regenerate with `node tools/screenshots/capture.mjs` (all) or by shot name (subset).

Assets are consumed by **both** the README and the Pages build (copied to `docs-site/media/` at build
time), so there is one canonical source per image — no duplicate files.

---

## Maintaining this matrix (release integration)

This matrix is kept honest by the release contract, not by memory:

1. **Every release** runs the Public Product + Documentation + Visual Review
   ([release process](reference/release-process.md)). It compares the release candidate against the
   previous published tag, generates the changed-capability inventory, and for each new or
   materially changed user-facing capability decides a disposition here.
2. The generated `RELEASE_REVIEW.md` (seeded by `npm run version`) lists the changed packages and
   requires each to be reconciled — Product / Docs / Visual — before promotion.
   `npm run docs:release-check` **blocks the `dev` → `main` promotion** until the review is resolved
   for the exact version being cut.
3. A row may legitimately settle on `not visually meaningful` or "no new image necessary" — but that
   is a **recorded decision**, never a silent omission. "We didn't check" is not an acceptable state.

The default rule is stronger than "keep docs current": **every user-facing feature is visually
documented somewhere** unless this matrix explicitly records why it isn't.
