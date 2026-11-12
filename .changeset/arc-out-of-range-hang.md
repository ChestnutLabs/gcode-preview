---
'@chestnutlabs/gcode-parser': patch
---

A G2/G3 arc whose points lie beyond the float32 range no longer hangs the parser. Segments dropped for an out-of-range stored position now count toward `maxSegments`, and an arc whose target or centre ± radius box is out of range is dropped whole, with the existing `number-out-of-range` warning, before any interpolation (#525).
