---
"@chestnutlabs/gcode-dialects": minor
"@chestnutlabs/gcode-parser": patch
---

feat(dialects): Simplify3D adapter — `; feature <lowercase>` roles (DD-026 T1)

New `simplify3d()` dialect adapter (RR-007 §5.5), registered in the built-in worker set. It captures
Simplify3D's lowercase `; feature <token>` vocabulary (`skirt`, `outer perimeter`, `inner perimeter`,
`infill`, `solid layer`, `support`, `raft`, `prime pillar`, `ooze shield`, …) as feature roles.
Simplify3D output has **no** object-membership channel, so `objects` stays honestly `unavailable`
rather than a fabricated membership — object framing falls back to feature-role classification
(DD-026 T2). Prime pillar / ooze shield map to the generic `Custom` role, never treated as model.
FDM geometry unchanged.
