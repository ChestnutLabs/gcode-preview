---
'@chestnutlabs/gcode-parser': patch
---

A G2/G3 arc that leaves out `I`, `J` (or `K` in G18/G19) now draws as an arc instead of a straight line.

An omitted centre offset is 0, as in RS274NGC and Marlin, so `G3 X0 Y10 J5` is the half circle it looks like.
Before, the missing word made the arc's segment count non-finite and the whole arc collapsed to one chord
from its start to its target. An arc with no `I`/`J`/`K` and no `R` at all has no centre to draw from: it is
drawn as a straight move to its target and the parse reports an `arc-missing-center` warning (once per file,
with a count).

You will only see a difference on files that omit an offset. In the bundled corpus that is `demo-3dbenchy`:
3 arcs that were drawn as chords now draw as multi-segment arcs (3 more segments in total).
