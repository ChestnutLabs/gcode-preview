---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

Render slicer wipe moves as an independently toggleable layer (DD-016 phase 2, #182).

Phase 1 populated `MoveKind.Wipe` from `;WIPE_START`/`;WIPE_END`; this makes those moves visible
and toggleable:

- **renderer-three**: wipe segments build into their own `'wipe'` geometry chunk (separate from
  travel), and `setKindVisible('wipe', …)` shows/hides them. Default visible — nothing disappears
  until a consumer opts out. Wipe geometry is exempt from travel decimation (it is sparse and the
  point is to see it).
- **core**: `setKindVisible` widens to `'extrude' | 'travel' | 'wipe'` (new `MoveKindToggle` type).
  The 2D renderer treats `'wipe'` as a documented no-op (the flat view has no distinct wipe form).
- **adapters** (Vue/React/Svelte/Element): a `showWipe` prop / `show-wipe` attribute (default true)
  mirrors `showTravel`.

Additive and backward-compatible; existing callers passing `'extrude'`/`'travel'` are unaffected.
Completes #182.
