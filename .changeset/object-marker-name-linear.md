---
'@chestnutlabs/gcode-dialects': patch
---

Hostile-input hardening for the dialect adapters, plus two object-marker accuracy fixes.

Hostile-input hardening (a crafted line or head could stall the parse for seconds, or effectively hang it):

- Slicer object markers (`; printing object <name> id:<n>`): a line that repeated `printing object`, or a
  `name:` suffix padded with spaces, took 0.7–7 s per 64 KiB line. Now linear.
- `estimated printing time` / `total estimated time` comments: a long whitespace line made the time parser
  backtrack polynomially (79 s at 500 spaces). Now linear.
- Slicer `key = value` comments with an all-whitespace value took ~5 s per 64 KiB line. Now linear.
- CNC / LinuxCNC detection: an unmatched `(` run or a long blank-line run in the 64 KiB head took 4–5 s
  per file. Now linear.

Object-marker accuracy: (a) a name containing a word that starts with "id" (`Ender idler pulley`,
`Box Identity`) was truncated at that word; (b) an `id<digits>` inside the name (`bracket(id2) id:7`) took
the object id, which could merge distinct objects. The object id is now the first whitespace-delimited
`id:<n>` token.

CRLF files: a Klipper `EXCLUDE_OBJECT_*` command and a PrusaSlicer `; estimated printing time (normal mode)`
comment were silently ignored when the file used `\r\n` line endings (the parser splits on `\n`, leaving a
trailing `\r`). Both are now read correctly, and a regression test runs the slicer fixtures with CRLF endings.
