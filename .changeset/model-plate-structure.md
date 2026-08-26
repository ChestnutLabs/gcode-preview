---
'@chestnutlabs/gcode-model-renderer': minor
---

feat(model): multi-plate model structure — plate identity as first-class API (DD-025 Phase A)

`parse3mf` now reads Bambu/Orca `Metadata/model_settings.config` and exposes declared plate structure on
`ModelScene`: a new `plates: { list: ModelPlateSummary[]; active? }`, a placement-level `plateIds` on each
`ModelObject` (aligned with `instances` — a reused master can appear on multiple plates, so membership lives
on the placement, not the master), and a `capabilities.plates` confidence tier (`'known'` only when the
source **explicitly** declares plates, incl. an explicit single plate; `'unavailable'` for
undeclared/implicit). `ModelReadyInfo` and `RenderModelStillResult` surface `plates` too, so a consumer can
build a plate selector. Plate grouping is derived from the source's own declaration (never geometric
guessing); a plate-less file is honestly one implicit plate. No render change yet — per-plate / all-plates
presentation is a later phase.
