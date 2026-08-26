---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model): staged loading progress on createModelViewer (DD-024 Phase A)

Adds the shared, typed, consumer-neutral loading-progress contract (`LoadStage` / `LoadUnit` / `LoadProgress`
in `gcode-renderer-three`) and wires it into `createModelViewer` via a new `onProgress` option — closing the
gap where the model renderer emitted no progress at all (large models "felt hung"). Events carry typed
`stage` / `done` / `total` / `unit` (or an honest `indeterminate`) and **no human-facing copy** — the
consumer owns all wording/i18n. `setSource` emits `parsing` (indeterminate) → `building-geometry` with real
per-object counts → `ready`. Every event is **generation-scoped**: a superseded/cancelled `setSource` can
never advance the next load's progress. No render behavior changes.
