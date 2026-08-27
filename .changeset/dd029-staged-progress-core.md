---
"@chestnutlabs/gcode-preview-core": minor
---

feat(core): staged preparation progress — `parsing`/`classifying` stages (DD-029 Phase A)

The controller now maps the parser's own phase to the DD-029 `stage` vocabulary: the `parsing` phase
emits `stage:'parsing'` with the real byte fraction, and the `finalizing` phase (where dialect
annotation settles) emits `stage:'classifying'`. The renderer's later `building-geometry`/`preparing-gpu`/
`ready` stages already forward through the controller, so a consumer sees the full ordered vocabulary
`parsing → classifying → building-geometry → preparing-gpu → ready`.

Additive: `parse-progress`/`parse-complete`/`buildComplete` are untouched. No geometry or render-policy
change.
