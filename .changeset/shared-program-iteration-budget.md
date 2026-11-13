---
'@chestnutlabs/gcode-parser': patch
---

`maxProgramIterations` now bounds the whole file: canned-cycle `L` repeats and O-word loops draw from one shared
budget, one unit per `L` repeat. Before, each `L` was capped on its own, so a handful of `L1000000000` lines could run
the parse up to its segment ceiling. A cycle whose `L` is more than what is left repeats only that many times (at least
once) and reports `canned-cycle-repeat-limit`, whose message now names the limit and how much was left. Files without
`L` repeats or O-word loops parse exactly as before.
