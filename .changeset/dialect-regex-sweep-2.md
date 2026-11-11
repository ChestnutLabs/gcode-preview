---
'@chestnutlabs/gcode-dialects': patch
---

Hostile-input hardening, second pass. Three more dialect regexes could stall a parse for seconds:

- CNC / LinuxCNC detection: a 64 KiB head of repeated `O` took ~22 s to scan for RS274NGC O-words (an
  unanchored regex rescanned the run from every position). Now a linear scan with identical results.
- Orca/Bambu `; total estimated time:` and PrusaSlicer `; estimated printing time (normal mode)` comments:
  a long whitespace run followed by an embedded line separator (U+2028/U+2029) took ~5 s per comment.
  Now linear; the parsed estimate is unchanged.
