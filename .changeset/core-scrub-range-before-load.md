---
'@chestnutlabs/gcode-preview-core': patch
---

Scrub and layer-range calls made while a file is loading are no longer lost. Vue, React, Svelte and the
Web Component inherit the fix.

- **A cut or layer range set before the file is shown now applies to that file.** Loading a file resets
  the view to the whole toolpath. A `setScrubPosition`, `setScrubTime` or `setLayerRange` call made before
  the first file finished loading, or while a new file was loading, could reach the renderer first and be
  wiped by that reset, depending on whether the 3D renderer had finished loading. Such a call now applies
  to the file being loaded, whatever the order.
- **`setScrubTime` before a file has loaded now takes effect.** There is no print-time axis until a file
  loads, so the call used to do nothing. It is now resolved on the loaded file's own time axis.
- **The latest call wins, and a clear counts.** `setScrubPosition(5)` then `setScrubPosition(null)` before
  the load leaves no cut. A failed or cancelled load keeps the request for the next file that loads.
- **Unchanged:** a call made once a file is shown applies to that file only. The next file you load still
  starts with the whole toolpath visible.
