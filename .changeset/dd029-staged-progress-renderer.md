---
"@chestnutlabs/gcode-renderer-three": minor
---

feat(renderer): staged preparation progress — `stage` event (DD-029 Phase A)

Adds a `stage` renderer event and `PreparationStage` type (DD-029 §4 D2) so consumers can show honest
preparation status instead of a bare spinner. The renderer emits `building-geometry` (with a real
`progress` fraction + `{built,total}` counts — the stage the user actually waits on), `preparing-gpu`,
and `ready`. `ready` coincides with `buildComplete` (never before it), and preparation failures still
terminate through the existing `error` path — there is no stage failure variant, so a consumer keys its
overlay off both terminals and never hangs.

Additive: `buildProgress`/`buildComplete`/`parse-progress` are untouched. (`parsing`/`classifying` are
emitted by `@chestnutlabs/gcode-preview-core` in a follow-up.) No geometry or render-policy change.
