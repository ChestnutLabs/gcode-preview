---
'@chestnutlabs/gcode-dialects': patch
---

Hostile-input hardening, second pass. Four more dialect regexes could stall a parse for seconds:

- CNC / LinuxCNC detection: a 64 KiB head of repeated `O` took ~22 s to scan for RS274NGC O-words (an
  unanchored regex rescanned the run from every position). Now a linear scan with identical results.
- CNC / laser detection's FDM-extrusion check: a 64 KiB head of repeated `G1` took ~7 s (each `G`
  rescanned the rest of its line for an `E` value). Now one pass per line with identical results.
- Orca/Bambu `; total estimated time:` and PrusaSlicer `; estimated printing time (normal mode)` comments:
  a long whitespace run followed by an embedded line separator (U+2028/U+2029) took ~5 s per comment.
  Now linear; the parsed estimate is unchanged.
