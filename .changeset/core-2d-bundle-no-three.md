---
'@chestnutlabs/gcode-preview-core': patch
'@chestnutlabs/gcode-renderer-three': patch
---

A 2D-only app no longer ships three.js. From v0.18.0 through v0.23.0, any bundle that imported
`@chestnutlabs/gcode-preview-core` (or a framework adapter) loaded all of three.js at startup, about 600 KB minified,
even with `renderer: { mode: '2d' }`. The 3D renderer was meant to load on demand, and now it does again. Measured on
`createPreviewController({ renderer: { mode: '2d' } })`: the startup bundle drops from 634 KB to 35 KB with Vite and from
641 KB to 37 KB with esbuild. Three.js moves to a chunk that loads only when a 3D view binds.

- **No API change.** Every import keeps working. `renderStill` loads the 3D renderer when it is called, so the first
  call does one extra dynamic import.
- **New: `@chestnutlabs/gcode-renderer-three/lite`.** A three-free entry with `CaptureUnsupportedError`, `studioTheme`,
  `STUDIO_CAMERA_FOV` and the theme, camera and capture types. Core imports only this entry statically. You normally
  don't need it, because the main entry exports the same values.
- **Your own tests:** the first 3D view now loads the renderer module when it binds, not when core is imported. A
  test that waits a fixed number of ticks for the 3D renderer to bind may need it preloaded once in its setup:
  `await import('@chestnutlabs/gcode-renderer-three')`.
- **If that load fails** (offline, or a stale deploy whose chunk now returns 404), the preview reports an `error`
  event with code `E_RENDERER_LOAD`, as it does for any 3D renderer that cannot start.
