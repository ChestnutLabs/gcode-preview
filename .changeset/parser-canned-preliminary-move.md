---
'@chestnutlabs/gcode-parser': patch
---

A canned cycle (`G81`/`G82`/`G83`) now starts with LinuxCNC's preliminary Z move: when the current Z is below the R plane, the tool first rapids straight up to R at the old XY, and only then rapids to the hole. Before, the parser rapided across at the low Z and climbed afterwards, so the drawn travel crossed the part below the clear plane. The extra segment is a travel move and appears only when the start Z is below R; a cycle that starts at or above R is drawn exactly as before, and later holes of a cycle never get it. A line-number prefix no longer hides a text-argument line: `N10 M117 Printing (50%` does not raise `unbalanced-paren-comment`, like the same line without `N10`. Nothing in the bundled test corpus changes (it contains no canned cycles).
