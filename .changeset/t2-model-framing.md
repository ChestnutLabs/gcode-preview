---
"@chestnutlabs/gcode-renderer-three": minor
---

feat(renderer): frame the printed model via `modelBounds` precedence (DD-026 D5/D6)

`frameContent: 'object'` now frames the classifier's model bounds, using the precedence
`modelBounds → objectBounds → bounds`. A label-less file that still marks its housekeeping (a prime
tower with no object channel) now frames the model, and a Bambu prime tower emitted inside an open
object bracket no longer inflates the frame (it is excluded from `modelBounds` even though it carries a
member label). `objectBounds` remains the second choice so nothing regresses for files that only label
objects.

The `E_FRAME_CONTENT_UNAVAILABLE` disclosure now fires only when **both** `modelBounds` and
`objectBounds` are empty — i.e. the file is genuinely unclassifiable and framing falls back to all
extrusion — and the message reports the `nonModelClassification` confidence. No geometry, colour, or
quality change; framing target only.
