---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
---

Add a bounded declarative theming API (E9 phase 4, #153, DD-009 D4).

A small, stable `Theme` object — `background`, `gridColor`, `bedColor`, `hemisphereIntensity`,
`directionalIntensity`, and a `materialPreset` (`'matte'` | `'glossy'`) — surfaced as a renderer
`theme` option + `setTheme()`, a controller `renderer.theme` option + `controls.setTheme()`, a `theme`
prop on the Vue/React/Svelte adapters, and a `theme` option on `renderStill` (so headless thumbnails
theme identically). The public type is three-free (`ThemeColor = number | string`) and re-exported
through `gcode-preview-core`, so it stays valid across `three` upgrades; deep customization keeps using
the `createRenderer` / `raw.renderer()` escape hatches.

Additive and opt-in — the defaults reproduce the existing look exactly, and `setTheme` uses replace
semantics (omitted fields reset to their defaults). Semantic colors (progress/retraction markers,
overlay ghost/band, and the origin tripod) are intentionally not themeable; the material preset affects
tube (extrude) geometry only — lines-quality geometry is unlit.
