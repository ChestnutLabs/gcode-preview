---
"@chestnutlabs/gcode-parser": minor
---

feat(parser): RS274NGC O-word control flow (DD-017 Phase 2, #189 phase 7)

Building on Phase 1's parameters + expressions, the parser now **executes** the RS274NGC O-word control
structures that CAM / LinuxCNC programs use to generate geometry: `if`/`elseif`/`else`/`endif`,
`while`/`endwhile`, `do`/`while`, `repeat`/`endrepeat`, and `break`/`continue`. A bolt-circle written as
a `while` loop over a computed angle, a pocket cut by a `repeat`, an `if` that selects a tool path —
these previously ran once (or not at all) because the parser is forward-only; they now resolve to the
full, correct toolpath.

A new module (`rs274-flow.ts`) is the program-buffered interpreter of DD-017 D1: engaged **only** when a
program actually contains an O-word control line (a cheap detection scan), it buffers the program, builds
a block tree, and executes it — feeding every non-control line back through the same engine so
geometry/params/expressions stay on one code path. Loops evaluate their conditions/counts against the
same shared parameter store, so `#<i> = [#<i> + 1]` inside a loop body does what you expect.

**Bounded and safe (this is now a small interpreter).** A new `maxProgramIterations` limit (default
`1_000_000`) bounds **total loop work** — charged per loop pass *and* per statement executed inside a
loop body, so a large body cannot multiply the real work past the cap — and stops a runaway `o while [1]`
with a partial result and a `rs274-iteration-limit` disclosure. Structural nesting is capped; loops are
ordinary iteration, not recursion, so an adversarial program can waste only bounded CPU — it cannot hang,
blow the stack, or OOM the worker. There is no `eval` and no I/O.

**Honest and additive.** Clean flow keeps `parametricProgram: 'known'`; a degraded run (a hit iteration
cap, an unbalanced or unsupported O-word, or a malformed condition) reports `'approximated'` and always
emits a specific disclosure — never silently wrong. Subroutines (`sub`/`call`/`return`) are a later phase
and are explicitly disclosed as unsupported and **not** executed inline. Non-parametric input never
enters the interpreter and stays **byte-identical** (both golden suites unchanged). Streaming input, which
cannot re-run a line range from a partial stream, discloses and runs linearly.
