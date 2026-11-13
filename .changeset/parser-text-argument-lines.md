---
'@chestnutlabs/gcode-parser': patch
---

Message text and Klipper commands no longer move the preview or change its colours.

- **Words inside message text are text.** A line such as `M117 Homing G28`, `M118 … G91`, `M117 F9000 fast` or
  Klipper's `RESPOND MSG="G28 done"` used to home the head, switch to relative moves or change the feedrate in the
  preview. These lines are now messages only. This also covers the SD-card file-name codes `M23`, `M28`, `M32`, `M33`
  and `M928`.
- **Klipper object names no longer change the tool.** `EXCLUDE_OBJECT_START NAME=part2` was read as a tool change to
  T2, so in tool colour mode the rest of the object took another tool's colour. `RESPOND MSG=at X50` no longer adds a
  move. Object exclusion still works as before.
- **A plain Klipper file is no longer reported as a parametric program.** The `[` in
  `EXCLUDE_OBJECT_DEFINE … POLYGON=[[…]]` used to set `capabilities.parametricProgram` to `'known'` and add
  `rs274-bad-expression` warnings. Such a file now reports `'unavailable'` with no such warning, which is what it is.
- `M486` keeps its object index and count (`S`, `T`, `P`, `U`, `C`), and the name after `A` is text:
  `M486 S2 A"part G28"` starts object 2 and does not home.
