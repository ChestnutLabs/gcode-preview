---
"@chestnutlabs/gcode-parser": minor
---

feat(parser): RS274NGC subroutines (DD-017 Phase 3, #189 phase 7)

Completes the RS274NGC programming layer: the parser now executes in-file O-word **subroutines** —
`o<id> sub`/`endsub`, `o<id> call [args]`, and `o<id> return`. A `call` binds its arguments to `#1`..`#30`
in a fresh call frame, runs the named sub's body, and returns; `return` exits early. Subroutines may be
forward-referenced (a `call` before the `sub` that defines it) and may recurse. This is how CAM/LinuxCNC
programs factor repeated geometry (a "stamp" drilled at many positions, a parametric feature reused
across a part).

**Correct scoping (recursion-safe).** Numbered parameters `#1`..`#30` and non-underscore named parameters
(`#<local>`) are LOCAL to each call frame; `#31`+ and underscore-named (`#<_global>`) are shared globals —
matching LinuxCNC. A recursive sub's `#1` therefore cannot clobber its caller's, and a sub's locals do not
leak out. The main program runs in the base scope, so a program that uses no subroutines behaves exactly
as before (byte-identical; both golden suites unchanged).

**Bounded and safe.** A new `maxCallDepth` limit (default `50`) caps subroutine recursion — an unbounded
or mutually-recursive `call` is disclosed (`rs274-call-depth`) and skipped, never a stack overflow. A
runtime execution-depth backstop additionally bounds the combined structural-nesting + call-depth JS
recursion. A sub called inside a loop still charges its body work against `maxProgramIterations`, so a huge
sub body cannot multiply work past the cap. `break`/`continue`/`return` are frame-local — they never jump
across a call boundary.

**Honest.** Clean subroutine execution keeps `parametricProgram: 'known'`; a degraded run (unknown sub,
recursion-limit hit, duplicate definition, misplaced `return`) reports `'approximated'` with a specific
disclosure — never silently wrong. Subroutine return VALUES are not yet propagated to the caller (a
documented Phase-3 limitation; `return` acts as an early exit). External subroutine files (`M98`,
`o<name> call` resolving to a separate `.ngc`) remain an explicit non-goal (no I/O in the parser).
