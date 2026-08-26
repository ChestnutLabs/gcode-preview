---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
---

`renderStill` builds to completion and renders once — large headless stills no longer pay for dozens of discarded renders

A `renderStill` builds its geometry across many microtask ticks, and the incremental build rendered
the whole (growing) scene **on every tick** — for a big tube mesh in software WebGL that's
dozens-to-hundreds of full MSAA rasterizations, all discarded except the last. A still only needs the
final frame.

The `ToolpathRenderer` gains a **`renderDuringBuild`** option (default `true`, preserving the
interactive viewer's progressive-build feedback). `renderStill` now sets it `false`: it builds the
geometry to completion and renders **once**, cutting the per-tick render waste that dominates a large
still's time in software rendering. Output is pixel-identical; `buildComplete` and all build events
still fire.

Note: this is one lever; a large still still builds the full tube mesh. Defaulting thumbnails to
`lines`, capping segments, and reusing the GL context across stills remain follow-ups.
