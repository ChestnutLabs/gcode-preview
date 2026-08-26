---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

feat(renderer): `qualityMode` fidelity policy — Full / Adaptive / Fast (DD-023 §4 D6, Phase B)

Adds a `qualityMode` option/prop (and `setQualityMode`) across the toolpath renderer, the core controller,
and all four adapters — the fidelity **policy**, distinct from the geometry `quality` tier (`lines`/`tubes`):

- **`'full'`** — render the COMPLETE representation: no every-Nth decimation, full-radial continuous tubes,
  and **no budget-driven tubes→lines fallback** (only the per-chunk vertex safety net remains). So a normal
  large plate renders at full quality on capable hardware instead of being gated down by the static ceilings.
- **`'adaptive'`** (default) — the capability-aware auto path (`auto` decimation + `tubeByteBudget`
  cross-section coarsening, disclosed). Reproduces today's behaviour exactly.
- **`'fast'`** — explicitly trade fidelity for responsiveness (flat lines).

This is the consumer control from the DD-023 Phase B contract: a user/admin picks the policy; `'full'` never
silently degrades. Capability-aware **auto** budget selection (classifier-driven Adaptive) and the
too-heavy-for-this-client signal land in a later increment. Additive — the default `'adaptive'` preserves
current behaviour.
