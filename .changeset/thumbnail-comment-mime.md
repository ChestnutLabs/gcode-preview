---
'@chestnutlabs/gcode-dialects': patch
---

JPG and QOI thumbnails embedded as G-code comments (`; thumbnail_JPG begin` / `; thumbnail_QOI begin`) now report their real `mime` (`image/jpeg` / `image/qoi`) instead of always `image/png`. A thumbnail block whose `end` line names a different variant than its `begin` line is now dropped rather than emitted.
