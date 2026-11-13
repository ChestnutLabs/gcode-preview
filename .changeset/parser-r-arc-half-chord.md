---
'@chestnutlabs/gcode-parser': patch
---

Fixed: an R-format arc whose radius is below half the chord now draws the forced half circle instead of one
straight chord. The parser raises such a radius to half the chord (`arc-radius-too-small`), but rounding could make
the arc's geometry slightly negative, and the arc was then drawn as a single straight line, for example
`G0 X0 Y0` / `G3 X-16.51 Y3.81 R-1`. Every file in the test corpus parses to the same IR as before.
