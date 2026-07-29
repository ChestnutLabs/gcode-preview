---
"@chestnutlabs/gcode-parser": minor
---

feat: modal motion continuation — bare coordinate lines repeat the last G0–G3 (DD-012 phase 2, #189)

CNC/LinuxCNC-style G-code frequently omits the `G` word on repeated moves (`G1 X0 Y0` then bare
`X10 Y0` / `X20 Y0`). The parser previously **dropped** those lines entirely — a three-move path
produced a single segment. It now tracks the active `G0`–`G3` motion mode and treats a line whose
leading word is a coordinate axis (`X`/`Y`/`Z`, with no `G`/`M`/`T` command) as a continuation of
that mode, so the full toolpath is emitted and classified/colored consistently (incl. inline `S`
for `toolPower`).

FDM output is **byte-identical** — slicers always emit the `G` word, so the continuation path never
triggers (the native-golden corpus is unchanged). This unblocks canned-cycle repeat (next phase).
