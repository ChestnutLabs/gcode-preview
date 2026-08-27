---
"@chestnutlabs/toolpath-core": minor
"@chestnutlabs/gcode-parser": minor
"@chestnutlabs/gcode-dialects": minor
---

feat(core): non-model classifier + `modelBounds` + `nonModelClassification` capability (DD-026 T2)

Adds the precedence-ordered classifier that decides which extrusion is the **printed model** and which
is slicer housekeeping, and exposes its result as a new additive `ir.modelBounds` bounding box plus a
`nonModelClassification` capability (`known` | `inferred` | `unavailable`).

`classifyModelBounds(segments, origin)` (exported from `@chestnutlabs/toolpath-core`, alongside
`HOUSEKEEPING_ROLES` / `isHousekeepingRole`) applies DD-026 D4 per extrusion segment: an explicit
housekeeping role (skirt, brim, raft, support, prime/wipe tower, purge) or a wipe move is excluded
first — so a Bambu prime tower emitted **inside** an open object bracket is excluded even though it
carries a member label; then, when a membership channel exists, only members are kept (an unmarked
prime at `object 0` is dropped); otherwise all non-housekeeping extrusion is the model (role fallback).

Confidence is honest and never a guess: `known` when per-segment membership drove it, `inferred` when
only role exclusion applied, `unavailable` (empty `modelBounds`) when there is neither membership nor
anything excludable — the genuinely unclassifiable case (e.g. a Simplify3D single object with an
unmarked prime line), which must fall back to full-extrusion framing and disclose. `objectBounds` keeps
its existing object-channel contract unchanged; `modelBounds` is strictly additive beside it.

The classification is derived at parse time from whatever channels exist (usually `unavailable`) and
**refreshed authoritatively** by the dialect runner's `finalize` once adapters have settled the
object/feature channels (lifecycle §5). Renderer framing consumes `modelBounds` in a follow-up.

Additive capability key + additive IR field only; FDM geometry is byte-identical (native goldens
regenerated for the new capability key alone — every `segmentCount` unchanged).
