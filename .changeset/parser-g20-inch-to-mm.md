---
'@chestnutlabs/gcode-parser': patch
'@chestnutlabs/toolpath-core': patch
---

Inch files (`G20`) now draw at their real size. **IR coordinates are always mm; `header.units` is the file's
declaration.**

- **Before:** after a `G20` the header said `units: 'in'`, but the coordinates stayed in inches and nothing scaled
  them, so an inch file drew 25.4× too small on a millimetre bed.
- **Now:** the parser multiplies every length word read under `G20` by 25.4: `X`/`Y`/`Z`, arc `I`/`J`/`K` and `R`,
  canned-cycle `R`/`Z`/`Q`, `G92` and `G10` offsets, the feedrate (in/min becomes mm/min) and `E`, as Marlin does.
  `P`, `L`, `S` and `T` are not lengths and are unchanged.
- `G20`/`G21` apply to the whole line they are on (`G0 X1 G20` is an inch move) and can switch mid-file; only the
  words read under `G20` are converted.
- RS274NGC `#` parameters are converted where they are used. `#5420`–`#5422` return the position in the program's
  units, as LinuxCNC does.
- A `G20` file carries one `units-converted` warning with severity `info`. A word that fits in inches but is too
  big for the IR once converted is dropped with the usual `number-out-of-range` warning.
- Inch arcs are flattened into ~0.5 mm segments, like mm arcs. The old inch-only ×25 segment factor is gone.
- If you labelled sizes or coordinates with `header.units`, label them mm: the numbers are millimetres for every file.
- A `G20` or `G21` inside message text (`M117 Printing G20 part`, `M118`, `M486`, Klipper `RESPOND`) is text: it
  does not switch units.

Millimetre files are unchanged: every file in the test corpus except the two inch files parses to the same IR.
