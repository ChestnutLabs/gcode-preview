---
title: Parametric programs (RS274NGC)
group: Concepts
category: Concepts
---

# Parametric programs (RS274NGC)

Some G-code doesn't spell out its geometry move by move — it **computes** it. A LinuxCNC or CAM
program can set a variable, evaluate an expression as a coordinate, loop, branch, and call a
subroutine, so a bolt circle is a `while` loop over an angle instead of twelve explicit `G1`s. The
parser runs that programming layer, so these files resolve to the real toolpath rather than rendering
empty or partial.

This is the **RS274NGC** programming layer — the dialect LinuxCNC implements. FDM slicer output never
uses it; CNC / CAM output routinely does.

## What runs

- **Parameters** — numbered `#1`–`#5399`, named `#<name>` (local) and `#<_global>` (global). Assign
  with `#1 = 5`; read anywhere a number is expected (`X#1`). Indirect (`##1`) and computed
  (`#[#1 + 1]`) references resolve too.
- **Expressions** — `[ … ]` anywhere a coordinate goes: `X[#1 + 2 * SIN[30]]`. The full RS274NGC
  operator set (`+ - * / MOD **`, comparisons, `AND` / `OR` / `XOR`) and functions (`SIN COS TAN ATAN
  ABS SQRT FIX FUP ROUND LN EXP` …) — trig in **degrees**, with LinuxCNC `MOD` / `EQ` semantics.
- **Control flow (O-words)** — `if` / `elseif` / `else` / `endif`, `while` / `endwhile`, `do` /
  `while`, `repeat` / `endrepeat`, `break` / `continue`.
- **Subroutines** — in-file `sub` / `endsub`, `call [args]` (arguments bind to `#1`–`#30` in the call
  frame), `return`. Subroutines may recurse and may be called before they are defined.

A bolt circle, computed:

```gcode
#<cx> = 50
#<cy> = 40
#<r>  = 20
#<n>  = 6
#<i>  = 0
o100 while [#<i> LT #<n>]
  #<a> = [#<i> * 360 / #<n>]
  G0 X[#<cx> + #<r> * COS[#<a>]] Y[#<cy> + #<r> * SIN[#<a>]]
  #<i> = [#<i> + 1]
o100 endwhile
```

The six rapids land on the circle: the loop runs and the degree-trig expressions evaluate, so the
preview shows the pattern the machine would follow — not an empty plate.

## It costs nothing on ordinary files

The interpreter engages **only** when a program actually uses `#`, `[`, or an O-word. Every FDM and
plain-CNC file takes the ordinary parse path and produces byte-for-byte identical output — enabling
this changed nothing for files that don't use it.

## Honesty and safety

Computed geometry is real geometry. When a program runs to completion, the `parametricProgram`
capability is **`known`**: the coordinates are a deterministic function of the program, so the
interpreter computes them — it does not guess. If something is off — a resource limit was reached, an
O-word was unbalanced or unsupported, a condition was malformed — the capability drops to
**`approximated`** and a specific warning names exactly what was lost. A non-parametric file reports
`unavailable`. It never silently renders the wrong thing.

A parametric program is a small program, so it is bounded like one. Two limits (part of the parser's
[`ParseLimits`](concept-workers.md)) keep a hostile or buggy file from hanging the parser:

- **`maxProgramIterations`** (default 1,000,000) bounds total loop work — an `o while [1]` stops with a
  partial result and a `rs274-iteration-limit` disclosure.
- **`maxCallDepth`** (default 50) bounds subroutine recursion — runaway or mutual recursion is
  disclosed (`rs274-call-depth`) and skipped, never a stack overflow.

There is no `eval` and no file I/O: the evaluator is a fixed arithmetic grammar over a fixed set of
functions, so an adversarial program can waste only bounded CPU.

## Limits

- **In-file subroutines only.** External subprogram files — Fanuc `M98 P…`, or an `o<name> call` that
  resolves to a separate `.ngc` — are out of scope; the parser does no file I/O.
- **Return values aren't propagated to the caller** yet; `return` acts as an early exit from the
  subroutine.
- **Persistent parameters** (LinuxCNC's `.var` file) aren't read — a program is interpreted in
  isolation.

For the construct-by-construct coverage table and every warning code, see
[G-code motion & position coverage](../compatibility/gcode-motion-coverage.md#rs274ngc-parametric-programs-dd-017);
for the design and its bounded-execution model, see
[DD-017](../design/DD-017-rs274ngc-parametric-programs.md).
