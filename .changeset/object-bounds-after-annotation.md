---
'@chestnutlabs/gcode-dialects': patch
---

fix(dialects): refresh `objectBounds` after object labels are annotated (frame-to-content on AnycubicSlicerNext & all labeled files)

`ir.objectBounds` (the extrude bounds of labeled objects, excluding skirt/prime/purge — used by
`frameContent: 'object'`, #306/#6) was computed by the parse core **before** dialects assign the object
channel, so it stayed empty (Infinity) even when objects were present, and `frameContent: 'object'`
silently fell back to `'all'`. On files with a large prime/purge column (e.g. AnycubicSlicerNext
multi-object prints) that framed the part small and off-center.

The dialect annotation pass now refreshes `objectBounds` after it fills the object channel, so
`frameContent: 'object'` frames the printed object rather than the whole build volume. This fixes it for
**every** dialect that labels objects (Klipper `EXCLUDE_OBJECT`, Marlin `M486`, Orca/Bambu `printing
object`), not just AnycubicSlicerNext. Object-label parsing itself was already correct — this was stale
derived bounds. Empty-when-no-labels behavior is unchanged (the honest "no object info" default).
