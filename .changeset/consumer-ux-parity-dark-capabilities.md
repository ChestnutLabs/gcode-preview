---
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Close the dark-capability gaps so no shipped capability is reachable only through the
`raw.renderer()` escape hatch, with full parity across all four framework adapters (DD-031).

**New on the public controller (`GcodePreviewControls`), so it flows to every adapter's `controls`:**

- `getRenderStats()` — the DD-027 render-diagnostics snapshot (backend, GPU, geometry mode, build
  parallelism, timings), previously reachable only on the Three renderer. Returns `null` on the 2D
  renderer (which produces no GPU/geometry diagnostics — never a fabricated stats object).
- `pickSegment(ndcX, ndcY, threshold?)` — source-mapping / segment picking, previously renderer-only.
- `isColorModeAvailable(mode)` — the honest per-file color-mode capability gate.

**New capability-aware state (`GcodePreviewState`):** `availableColorModes`, `hasRetractions`,
`hasColorChanges` — refreshed after each parse, so a UI can offer and *explain* controls instead of
guessing (e.g. gray out feature coloring on a file with no feature roles, with a reason).

**Adapter parity:**

- `hiddenFeatureRoles` is now a declarative prop (Vue/React/Svelte) and a `hidden-feature-roles`
  attribute (Web Component) — the declarative form of `setFeatureRoleVisible` (hide Skirt/Brim to
  declutter a part). Gate it on `capabilities.featureRoles`.
- `capture()` is now a top-level method on the Vue/React/Svelte handles too, matching the Web
  Component's `element.capture()`.
- Web Component: `renderer`/`adjacentLayers` gain property accessors; the package now also re-exports
  `RendererMode` and `PreviewRenderer`.

All additive — existing code keeps working unchanged; the 2D renderer honors the widened contract as
documented no-ops / honest `null`. The portable behavioral suite is extended (layer-range, color-mode
gating, diagnostics + picking reachability) and gains a controls-completeness parity guard so a
capability can no longer ship in core and silently vanish from an adapter.
