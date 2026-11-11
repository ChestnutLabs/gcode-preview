---
'@chestnutlabs/gcode-dialects': patch
---

A hostile G-code line that repeats `printing object` could stall the parse: the object-name extraction
re-scanned the whole line at every repeat, so one 64 KiB line took about 740 ms and ~100 of them added
over a minute. The name is now read with a single linear pass; the extracted names are unchanged for
every real OrcaSlicer, Anycubic, Bambu and PrusaSlicer marker.
