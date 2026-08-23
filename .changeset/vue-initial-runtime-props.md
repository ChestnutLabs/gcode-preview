---
"@chestnutlabs/gcode-preview-vue": patch
---

Fix: Vue adapter now applies runtime-only props on first render (initial-state desync).

Vue's `watch()` does not fire on mount, so a runtime control prop set at mount time —
`:show-travel="false"`, `:show-wipe`, `:show-retractions`, `:layer-range`, `:scrub`,
`:scrub-time`, `:view`, `:camera-state`, `:progress` — was dropped and only took effect on a
later *change*. The most visible symptom: travel moves rendered on first open despite
`:show-travel="false"`, correct only after toggling. The other three adapters were unaffected
(React's `useEffect`, Svelte's `$:`, and Element's `applyRuntimeState()` all apply the initial
value on mount).

These runtime-only watchers are now `{ immediate: true }`, so initial prop values apply at
mount. Controls issued before the renderer resolves are queued and replayed, so firing at mount
is safe. The construction-covered props (`colorMode`, `quality`, `cameraMode`, `theme`, plain
`buildVolume`) are unchanged — they are already applied as renderer options at controller
creation. Additive and backward-compatible.
