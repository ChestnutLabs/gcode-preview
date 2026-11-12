---
'@chestnutlabs/gcode-parser': patch
---

A G2/G3 arc that leaves out `I`, `J` (or `K` in G18/G19) now draws instead of vanishing.

An omitted centre offset is 0, as in RS274NGC and Marlin, so `G3 X0 Y10 J5` is the half circle it looks like.
Before, the missing word produced non-finite coordinates that the renderers skip, so those arcs disappeared
from the preview. An arc with no `I`/`J`/`K` and no `R` at all has no centre to draw from: it is drawn as a
straight move to its target and the parse reports an `arc-missing-center` warning (once per file, with a
count).

You will only see a difference on files that omit an offset. In the bundled corpus that is `demo-3dbenchy`
(3 more segments; its arcs now draw).
