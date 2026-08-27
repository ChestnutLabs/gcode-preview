---
"@chestnutlabs/gcode-parser": minor
---

feat(parser): RS274NGC parameters + expressions (DD-017 Phase 1, #189 phase 7)

The parser now understands the RS274NGC *programming* layer that FDM slicers never use but CAM /
LinuxCNC output routinely does: numbered/named/global parameters (`#100`, `#<name>`, `#<_global>`),
assignment (`#n = <expr>`), and bracket expressions (`[ … ]`) usable wherever a numeric word value is
expected (`X[#1+2]`, `F[#feed]`, `Z#<depth>`). Previously these were silently dropped, so parametric
programs rendered honest-but-**empty**; they now resolve to real geometry.

A new self-contained module (`rs274.ts`) provides a pure recursive-descent evaluator — the RS274NGC
operator + function set with correct precedence (`**` > `*/MOD` > `+-` > comparisons > logical),
**degree**-based trig, LinuxCNC `MOD`/`EQ` semantics, `FIX`/`FUP`/`ROUND`, indirect `##n` and computed
`#[expr]` references, and a read-only system-parameter allow-list (`#5420–#5422` = current position).
It is bounded and safe: a depth guard on nested brackets, **no `eval`/`Function`**, and a capped
parameter store, so a hostile program can waste only bounded CPU. Malformed input never throws out of
the parse — the offending word is dropped with a specific disclosure (`rs274-bad-expression`,
`rs274-uninitialized-param`, `rs274-unsupported-sysparam`) and parsing continues.

Honest and additive: a new `parametricProgram` capability (`known` when executed, `unavailable`
otherwise). Engaged only on lines that use `#`/`[` — every FDM and simple-CNC line takes the untouched
lexer and is **byte-identical** (native goldens regenerated for the additive capability key only; the
detection gate adds ~2.7% to a large FDM parse, geometry unchanged).

**Scope: Phase 1 (parameters + expressions) only.** O-word control flow (`if`/`while`/`sub`/`call`) is a
later phase and is not yet supported — such constructs are ignored (and will be disclosed) for now.
