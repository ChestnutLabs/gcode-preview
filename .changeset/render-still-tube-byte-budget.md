---
"@chestnutlabs/gcode-preview-core": minor
---

feat(render-still): expose `tubeByteBudget` on `RenderStillOptions`

`renderStill` now accepts `tubeByteBudget?: number`, forwarded to the renderer's existing option. This is
the **final-geometry** byte budget (RR-006) — a **different axis** from `geometryMemoryBudgetBytes` (the
parallel build's in-flight transient cap): it bounds the whole retained tube mesh and so decides whether a
large plate renders as full **tubes** or degrades to **lines**.

Previously the headless still was stuck behind the conservative default (~450 MB CPU / ~900 MB peak), so a
big full-sheet plate silently fell to lines even when the deployment had RAM to spare, with no way to opt
in. A caller whose resource policy says the RAM is available can now raise the budget to retain tubes on
large plates (peak RAM ≈ 2× the budget). The library never reads the container — choosing a value from the
actual CPU/RAM grant is deployment policy, not baked into gcode-preview.

Additive and behavior-preserving at the default. `geometryMemoryBudgetBytes` (CPU parallelism transient)
and `tubeByteBudget` (final-geometry retention) are independent knobs, matching the two-axis
capability-aware model the DD-028 headless characterization established.
