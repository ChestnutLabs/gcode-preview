---
"@chestnutlabs/gcode-parser": minor
---

feat: lexer handles multi-command lines, N-word line numbers, and bare S/F (#189)

Real CNC/laser G-code (GRBL, LinuxCNC, TinyG, Mach3, Fanuc) is written very differently from FDM
slicer output, and the inherited first-word lexer silently dropped most of it. The lexer now:

- **Reads every G/M/T command word on a line**, not just the first — `G20 G17 G90`, `G91 G81 …`,
  `S3400 M3` now all apply. This was the biggest gap: `M3` spindle-on and `G81` canned cycles were
  being dropped as params, so mills showed no `Cut` moves and drilled holes vanished.
- **Strips `N`-word line numbers** (`N10 G1 X…`) — Fanuc/Mach/TinyG number every line, which
  previously reduced whole files to zero geometry.
- **Latches bare `S` / `F` lines** (standalone `S1000` / `F600`) into modal power/feed — common in
  GRBL-laser output.
- Guards against **letters embedded in extended-command words** (`EXCLUDE_OBJECT … POLYGON=…`): a
  command/param is only taken when a real number follows the letter, so `T` in `M486 T<count>` /
  `M104 T<tool>` stays a parameter (not a tool select), and the `G` in `POLYGON` never becomes a move.

Validated against real public sample files: a LinuxCNC arc-spiral went from 16 → 5,506 parsed
segments, a TinyG program from 0 → 344. **FDM output is byte-identical** — slicers emit one clean
command per line, so the multi-command path never runs for them (the real-G-code native-golden corpus
is unchanged except for fewer spurious `unsupported-command` warnings; `demo-mach3` and one adversarial
binary fixture are documented intentional divergences).
