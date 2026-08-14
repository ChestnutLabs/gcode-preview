---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Adapter surface: capabilities/warnings on `ready` + declarative `view`/`cameraState` (#275 M3+M6)

**M3** — the `parse-complete` / `ready` event now carries `capabilities` (the per-field confidence
map) and `warnings` alongside `{ segments, layers, complete }`, so consumers can gate their own UI on
capability-honesty without reaching for the raw handle.

**M6** — the `setView`/`getCameraState`/`setCameraState` methods (#268) get first-class declarative
props on all four adapters: a `view` prop (preset orientation) and a `cameraState` prop (restore),
paired with a new **`camera-changed`** event (renderer → controller → adapters, emitted when a user
camera interaction settles) so a `cameraState` binding round-trips. The 2D renderer keeps disclosing
via `renderer-unsupported` rather than fabricating a pose. Behavioral-suite coverage added for the
capabilities/warnings payload across all four adapters.
