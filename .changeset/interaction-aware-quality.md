---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Interaction-aware render quality (#306 item 2, DD-020). New opt-in `interactionQuality: 'off' | 'auto'`
renderer option + `controls.setInteractionQuality` + an `interactionQuality` prop / `interaction-quality`
attribute on all four adapters. With `'auto'`, the renderer **reduces render detail (pixel ratio) while
the camera is moving and restores full detail when it settles** (short debounce), so orbiting a heavy tube
scene stays responsive without permanently dropping to lines. The reduction is proactive (a gesture starts
at 0.6× the resting pixel ratio) and adapts to measured frame time within a clamped `[0.4, 1]` band. The
hard vertex-budget `quality-fallback` (tubes → lines when a chunk can't allocate) is unchanged as the final
safety net. **Default `'off'` — existing behavior is byte-identical.** The 2D renderer treats it as a
documented no-op.

A consumer maps a High / Balanced / Performance preference on top: High = `quality:'tubes'` +
`interactionQuality:'auto'`; Balanced = `quality:'auto'` + `interactionQuality:'auto'`; Performance =
`quality:'lines'`.
