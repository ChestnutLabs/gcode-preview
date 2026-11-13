---
'@chestnutlabs/gcode-parser': patch
---

Three parser corrections. A `;` inside a `( … )` comment no longer starts the `;` comment that `onComment` reports: `G1 X1 (a;b) ; real` now reports ` real`, the same split the lexer makes. An unclosed or nested `(` comment now raises one `unbalanced-paren-comment` warning per file (LinuxCNC rejects both; the parse carries on as before, and lines that start with a multi-letter command word such as Klipper `EXCLUDE_OBJECT_START NAME=cube_(1` are not checked). Under `G91`, a canned cycle's `R` and `Z` are now sticky numbers: a later `G81`/`G82`/`G83` block, or a bare `X`/`Y` repeat, that leaves one out applies it again from its own current Z instead of reusing the first block's absolute plane. This differs only with `G99` (retract to the R plane); `G90` cycles and `G98` cycles are unchanged. Nothing in the bundled test corpus changes geometry.
