---
'@chestnutlabs/gcode-parser': patch
---

A `( … )` comment on an ordinary G-code line is now ignored, as it already was on lines that use `#` parameters or `[ ]` expressions. Before, `G1 X1 Y1 (then G1 X99)` also moved to X99 and read any letter inside the parentheses as a command or axis word, which affected Fanuc, Mach and LinuxCNC files that annotate moves. An unclosed `(` comments out the rest of the line, and a `;` inside the parentheses no longer cuts the line short. This also fixes two related cases: a comment placed straight after the command word (`G1 (fast) X1`, `M486 (label) S1`) used to drop the whole command, and a comment-only line such as `(T2 D=6)` used to run a tool change. Files without parentheses parse exactly as before.

Also: `limits.maxInputBytes` above 4 294 967 295 (2^32 - 1) now throws `E_PARSE_OPTION`, because source byte offsets are stored in 32 bits and a larger input would wrap them.
