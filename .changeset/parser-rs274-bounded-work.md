---
'@chestnutlabs/gcode-parser': patch
---

Hostile parametric (RS274NGC) programs can no longer keep the parser busy for hours. Work inside a loop or subroutine now counts against `maxProgramIterations` per test, argument, entered loop and 256 characters of text, not only per statement, so programs with many `elseif` branches, long conditions or many `call` arguments inside loops stop sooner with the existing `rs274-iteration-limit` warning. A plain loop still costs 2 units per pass, and code outside loops and subroutines is never counted. A loop whose body tests `if`/`elseif` conditions now uses more of the budget on each pass, so a long-running legitimate program close to the default limit of 1 000 000 can stop earlier than before; raise `maxProgramIterations` if it does.

Also in this release:

- A very long chain of `**` operators (about 20 000 terms, under the line-length cap) no longer overflows the stack and throws out of the parse. Past 64 levels the word, assignment or condition is dropped with `rs274-bad-expression`.
- A comparison or logic operator (`GT`, `EQ`, `AND`, …) with a non-finite operand, such as `1/0 GT 5`, and a non-finite parameter index, such as `#[SQRT[-1]]`, now give `rs274-non-finite-value` and are treated as 0 instead of passing silently.
- Assigning to `#0`, a negative parameter or a read-only system parameter (`#5400` and up) is ignored with the new `rs274-readonly-param` warning.
- `ROUND` rounds halves away from zero, as LinuxCNC does: `ROUND[-2.5]` is now `-3` (it was `-2`).
