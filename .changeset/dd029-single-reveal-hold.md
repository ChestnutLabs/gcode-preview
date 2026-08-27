---
"@chestnutlabs/gcode-renderer-three": minor
---

feat(renderer): single clean reveal — strengthen `progressivePreview:'hold'` + add `'auto'` (DD-029 Phase B)

`progressivePreview` gains `'auto'` (`'auto' | 'lines' | 'hold' | 'off'`), and `'hold'` becomes a **true
single clean reveal**: the growing scene is no longer rendered on every build tick (the ~187
intermediate renders RR-008 §8.1 measured) — the completed scene is rendered exactly **once**, at
completion. Previously `'hold'` only suppressed the line *preview* but still re-rendered the growing tube
scene each tick.

`'auto'` (the eventual default) will pick `'lines'` vs `'hold'` per build from a render-cost/capability
estimate; until that estimate lands (DD-029 Phase D) it resolves to `'lines'`, so **no behavior changes
on upgrade** (the option default stays `'lines'`). No mode drops extrusion segments or lowers final
geometry quality — this only controls how often incomplete work is drawn. Headless `renderStill`
(`renderDuringBuild:false`) is unaffected. Consumers wanting the single reveal (e.g. AnyBridge) select
`'hold'` explicitly.
