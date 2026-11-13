---
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
'@chestnutlabs/gcode-preview-vue': minor
'@chestnutlabs/gcode-preview-react': minor
'@chestnutlabs/gcode-preview-svelte': minor
'@chestnutlabs/gcode-preview-element': minor
---

CNC and laser Cut moves are now their own toggleable move kind (`'cut'`), no longer hidden or dropped with travel.

- **Fixes:** a Cut segment used to land in the travel chunk. Hiding travel hid the cuts (so a CNC file looked empty),
  and under decimation the cuts were dropped along with travel.
- **Decimation:** cuts now follow the same rule as extrusion (kept if first/last of a layer or every Nth), so a large
  CNC file thins out instead of disappearing.
- **New toggle:** `setKindVisible('cut', visible)`, `showCut` on Vue, React, Svelte and `renderStill` (default `true`),
  and `show-cut` / `showCut` on `<gcode-preview>`.
- **2D view:** draws Cut moves too, and honours the same toggle (see the `gcode-renderer-2d` entry).
- FDM files have no Cut moves and render exactly as before.
