---
"@chestnutlabs/gcode-model-renderer": minor
---

feat(model-renderer): per-plate / object-subset render scope (DD-030 D2)

A caller can now render just **one plate** (or any object/placement subset) of a multi-plate / multi-object
source, instead of always the whole project — so a single-plate variant thumbnail looks like *that* plate.

New `RenderScope` selector — `{ plateId }`, `{ objectIds }`, or `{ instanceFilter }` — with a pure,
three-free `applyRenderScope(scene, scope)` that returns a filtered `ModelScene` (dropping non-matching
objects/placements) with `bounds` recomputed from the kept placements, so framing follows the subset.
`{ plateId }` is sugar over the placement-level `plateIds` (DD-025); it's generic (a plate is just one way
to derive the subset) and vendor-neutral.

Wired into both surfaces:
- `renderModelStill` gains a `renderScope?` option; it also folds the scope into the still `cacheKey` so a
  plate-1 and a plate-2 thumbnail of the same source key distinctly (an opaque `instanceFilter` is marked
  non-cacheable).
- `createModelViewer` gains an initial `renderScope?` and a `setRenderScope(scope | null)` handle method
  that rebuilds and reframes to the subset (`null` restores the whole source).

Honest and additive: omitting `renderScope` renders the whole project exactly as before. A `{ plateId }`
that matches nothing (e.g. a source with no declared plate structure, `capabilities.plates !== 'known'`)
renders an **empty** scene by design — the honest result of selecting a plate that isn't declared;
consumers gate `{ plateId }` on `plates: 'known'`. The source's declared `plates`/`capabilities` are
preserved (only what is *rendered* is narrowed). Second increment of the DD-030 renderer/viewer interop
batch.
