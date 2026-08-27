# DD-017 — RS274NGC parametric programs: parameters, expressions & O-word flow (#189 phase 7)

**Status:** **Accepted (Phase 1 only)** — Phase 1 (parameters + expressions, D2/D3, §5.1) accepted &
built 2026-08-27; **Phases 2–4 (O-word control flow, subroutines) remain Proposed**, gated on measured
Phase 1 results. <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut
**Date:** 2026-07-29 · **Last revised:** 2026-08-27
**Owning Epic:** #189 (non-extrusion toolpath coverage), **phase 7** · **Milestone:** Future
**Supersedes / Superseded by:** none
**Related:** [DD-012](./DD-012-non-extrusion-toolpath-and-modal-tool-state.md) (non-extrusion move model — this extends its parser work; §16 spec anchors), [RR-004](../research/RR-004-non-extrusion-toolpath-coverage.md) §9 (spec landscape), DD-010 (motion interpreter this builds on), DD-003 (parser resource limits — this adds two), DD-001 (capability/confidence model). Reference spec: **RS274NGC / NIST IR 6556** (free), as-implemented by the **LinuxCNC G-code reference** (cited as behavioral parity, no text copied — RR-004 §6).

---

> **Why now.** Real LinuxCNC / CAM output routinely uses the RS274NGC *programming* layer — numbered/named
> **parameters** (`#100 = 5`), **expressions** (`X[#1 + 2*sin[30]]`), and **O-word** subroutines/loops/
> conditionals. The parser lexes these tokens away today (`Number('[#1+5]')` → `NaN`, dropped), so a
> parametric program renders **partial or empty geometry**. This is the largest remaining #189 gap and,
> unlike the laser semantics, it is **fully spec-derivable** — build to RS274NGC, no hardware needed to
> get it right (hardware only re-confirms). But it turns the parser into a small **interpreter** (symbol
> table + expression evaluator + control flow that re-executes and skips lines), which is
> architecture-sensitive — hence this DD before any code.

## 1. Problem

The engine is a **forward-only line processor**: `Engine.processLine(rawLine, offset)`, called once per
line in source order (`parse.ts:252`). RS274NGC programs violate every assumption of that model:

- **Parameters** are mutable state (`#n = [expr]`) read anywhere later (`X#100`) — a symbol table.
- **Expressions** (`[ ... ]`) can appear as *any* word value and must be **evaluated**, not read.
- **O-word flow** re-orders execution: `while`/`endwhile` and `repeat`/`endrepeat` **re-run** a line
  range; `if`/`endif` **skips** one; `sub`/`call`/`return` **jump**. Forward-only cannot express this.

Today's lexer (`lexLine`) splits on letters and does `Number(value)`, so `#`, `[`, `]`, and `=` are not
tokens it understands — parametric words are silently dropped. The result is honest-but-empty
(`unavailable`/missing geometry), never *wrong*, but it is a real coverage gap for the CNC class.

## 2. Scope

A **pragmatic RS274NGC subset**, engaged only when the constructs appear (FDM and simple CNC untouched):

1. **Parameters** — numbered `#1`–`#5399`, named `#<local>` / `#<_global>`, assignment `#n = <expr>`,
   reference `#n` as any word value; a **read-only** subset of system parameters.
2. **Expressions** — `[ ]` grouping; the RS274NGC operator + function set; all values are `f64`.
3. **O-word control flow** — `sub`/`endsub`/`call`/`return`, `if`/`elseif`/`else`/`endif`,
   `while`/`endwhile`, `do`/`while`, `repeat`/`endrepeat`, `break`/`continue`; numeric or named O-words.
4. **Two new resource limits** — bounded iteration + recursion (DD-003 family) so a `while [1]` or
   infinite recursion cannot hang or OOM the worker.
5. **Capability + honesty** — computed geometry is `known` (deterministic); any unhandled construct is
   **disclosed** (warning + capability), never guessed.
6. **Fixtures** — MIT-clean synthetic parametric programs with expected resolved geometry (golden-gated).

## 3. Non-goals

- **External subroutine files** (`M98 Pnnn` Fanuc-style program calls, `o<name> call` resolving to a
  separate `.ngc` file) — needs a filesystem/program library; **out** (no I/O in the parser). In-file
  subroutines only. (Fanuc `M98`/`M99` numeric subprograms: a possible later follow-up, noted not built.)
- **Persistent parameters** across program runs (the LinuxCNC `.var` file) — we interpret a single
  program in isolation; persistent `#5xxx` read as their documented power-on defaults or `0`/disclosed.
- **G-code that mutates machine config** (tool tables `G10 L1`, offset writes beyond DD-010's `G10 L2/L20`)
  — motion only, per DD-012 §3.
- **Changing any FDM or simple-CNC behavior** — byte-identical regression gate holds (D7).
- **Full RS274NGC conformance** — a subset that covers real LinuxCNC/CAM output; gaps disclosed, not faked.

## 4. Decisions

Decision points **D1–D8**, each with options and a recommendation for maintainer acceptance.

### 4.1 D1 — Execution model: where interpretation lives *(the pivotal decision)*

O-word flow needs random line access; the engine is forward-only. Three ways to reconcile:

- **Option A (recommended): a program-buffered interpreter layer, engaged on demand.** A cheap first
  scan flags whether the program contains any RS274NGC construct (`#`, `[`, or a leading `o`-word). If
  **none** (all FDM, and most simple GRBL/laser CNC), the existing forward-only fast path runs
  **unchanged and byte-identical**. If **present**, buffer the program's lines (already fully in memory —
  `createEngine` decodes the whole `text`), build an **O-word block index** (sub/if/while/repeat spans),
  and run a small interpreter with a program counter + parameter table + expression evaluator that
  resolves each executed line to a concrete word set and feeds the **same segment-emitting core**
  (`g0`/`g2`/dispatch). One motion/classification code path; the interpreter only *feeds* it.
- **Option B: inline control flow in the main loop.** Give the engine a program-counter and line array
  always. Rejected: burdens the hot FDM path with interpreter bookkeeping for a feature it never uses;
  muddies the byte-exact core.
- **Option C: a separate `gcode-rs274` package / parse mode.** Rejected: the motion semantics are the
  same interpreter (DD-010) — a fork duplicates dispatch, classification, limits, goldens (cf. DD-012 D1).

**Streaming note:** O-word programs cannot be interpreted from a partial stream (loops need the whole
body). Detection ⇒ buffer fully; these files are small (hand/CAM-written, not million-line FDM). The
streaming driver keeps working for non-parametric input; a parametric program detected mid-stream is
interpreted once fully buffered (or disclosed if the stream is truncated).

### 4.2 D2 — Parameters

- **Numbered** `#1`–`#5399`: a dense/lazy `Float64` store. Read-before-write ⇒ `0` (RS274NGC default)
  **with a disclosure** the first time (an uninitialized read is often a program bug).
- **Named** `#<name>` (local to the current sub scope) and `#<_global>` (leading underscore = global):
  a `Map` per scope frame.
- **Assignment** `#n = <expr>` / `#<name> = <expr>`: evaluated at execution time, honoring flow (a
  `while` body re-assigns each pass).
- **System parameters** (read-only subset): current position (`#5420`…), active coord system, etc. —
  **Recommend a small allow-list** we can resolve from IR state; anything else reads `0` + disclosed.
  Rejected: full system-param emulation (feeds/speeds, tool geometry) — DD-012 §3 non-goal.

### 4.3 D3 — Expressions

Recursive-descent evaluator over the RS274NGC grammar; all values `f64`; booleans are `1`/`0`.

- **Binary:** `+ - * /`, `MOD`, `**` (power), `AND OR XOR`, comparisons `EQ NE GT GE LT LE`. RS274NGC
  precedence (`**` > `* / MOD` > `+ -` > comparisons > logical).
- **Unary functions:** `ABS ACOS ASIN COS SIN TAN EXP FIX FUP LN ROUND SQRT` and the two-arg
  `ATAN[y]/[x]`; `EXISTS[#<name>]`.
- **Grouping** `[ ]` (RS274NGC uses brackets, not parens; `( )` stays a **comment**, unchanged).
- Evaluated wherever a numeric word value is expected (`X[…]`, `F[…]`, `#n = […]`, `o<n> if […]`).
- Malformed expression ⇒ that word is dropped **with a disclosure**, parse continues (never throw out).

### 4.4 D4 — O-word control flow

Support the constructs real programs use; each O-word keyed by its number/name:

- `o<n> sub` … `o<n> endsub`; `o<n> call [a1] [a2] …` (args → `#1`…`#30` in the callee frame);
  `o<n> return [expr]`.
- `o<n> if [c]` / `o<n> elseif [c]` / `o<n> else` / `o<n> endif`.
- `o<n> while [c]` / `o<n> endwhile`; `o<n> do` / `o<n> while [c]`; `o<n> repeat [count]` / `o<n> endrepeat`.
- `o<n> break` / `o<n> continue`.
- **Recommend a one-pass block indexer** (match each opener to its closer, record line spans) before
  execution, so jumps are O(1). Unbalanced O-words ⇒ disclosed, that block skipped.

### 4.5 D5 — Resource limits & security *(required — this is now a bounded interpreter)*

RS274NGC is effectively Turing-complete; `o while [1]` or unbounded recursion must not hang/OOM the
worker. Extend `ParseLimits` (DD-003):

- **`maxProgramIterations`** — total loop-body executions across the program (recommend `1_000_000`);
  exceeding ⇒ stop with a `StopReason` (like `maxSegments`), partial IR returned, disclosed.
- **`maxCallDepth`** — subroutine recursion depth (recommend `50`); exceeding ⇒ disclosed, call skipped.
- Existing `maxSegments`/`maxBufferBytes` still bound emitted geometry. Parameter store bounded by the
  `#1`–`#5399` range + a cap on named params. **No I/O, no `eval`** — a pure arithmetic evaluator over a
  fixed grammar (no user-defined functions), so no code-execution surface. Ties to DD-003's adversarial
  posture: a hostile parametric program can waste bounded CPU, nothing more.

### 4.6 D6 — Capability & honesty

- New capability key **`parametricProgram`** (name TBD): `known` when the program used params/expr/O-words
  **and we executed them within limits**; `approximated`/disclosed when a limit was hit or a construct was
  skipped; `unavailable` for non-parametric files. Resolved coordinates themselves remain `known` (they
  are deterministic functions of the program) — the interpreter computes, it does not infer.
- Every skipped/unhandled construct emits a specific warning code (e.g. `rs274-unsupported-oword`,
  `rs274-iteration-limit`, `rs274-uninitialized-param`) so the harness/UX can surface exactly what was lost.

### 4.7 D7 — Byte-exactness, goldens & provenance

- **FDM + simple-CNC byte-identical:** the fast-path gate (D1) means any file with no `#`/`[`/`o`-word
  takes the untouched path; the golden-equivalence + native-golden gates prove it.
- **New parametric fixtures** (synthetic, MIT-clean) with **expected resolved geometry** as goldens:
  a param+expression part, a `while` loop (bolt-circle), an `if`/`else`, a `sub`/`call` with args, a
  `repeat`. Assertions on emitted segment positions/kinds.
- **`srcByte`** for a computed segment maps to the **executing source line** (the loop body line, not the
  `while` header) so source-mapping stays meaningful; document the convention.
- Provenance: semantics implemented from RS274NGC/LinuxCNC **behavior**, expressed in our own code —
  **no spec text copied** (ISO/ LinuxCNC-GFDL constraint, RR-004 §6).

### 4.8 D8 — Delivery shape

Additive to `@chestnutlabs/gcode-parser` only (no new package, no IR shape change — resolved words feed
the existing SoA). No renderer/adapter/color changes (they consume the same segments). One `minor` bump.

## 5. Phased delivery (proposed, on acceptance)

1. **Expression evaluator + parameters** (no flow yet): lex `#`/`[`/`]`/`=`, the evaluator, the param
   store, the fast-path detection gate. A straight-line parametric program (assignments + `X[expr]`)
   renders correctly. Golden: param+expression part. *FDM byte-identical proven here.*
2. **O-word block indexer + conditionals + loops** (`if`/`while`/`do`/`repeat`) + the two limits.
   Golden: bolt-circle `while`, an `if`/`else`.
3. **Subroutines** (`sub`/`call`/`return`, arg binding, `maxCallDepth`, named O-words). Golden: `sub` with args.
4. **Capability + disclosure surface + docs** (`parametricProgram`, warning codes; the compatibility
   matrix + a manual page; harness "skipped commands" already surfaces the warnings). Real LinuxCNC
   file re-checked through the validation harness as confirmation (not a gate — this is spec-derived).

## 6. Alternatives considered

- **Stay honest-but-empty** — rejected: it's the single biggest CNC coverage gap and is fully
  spec-derivable; leaving it forfeits real LinuxCNC/CAM files.
- **Ship without loop/recursion limits** — rejected: an unbounded interpreter in a worker is a DoS hole.
- **A dependency (an existing RS274NGC JS interpreter)** — rejected: license/provenance risk, dependency
  weight, and our evaluator only needs a fixed grammar; DD-003 limits must be first-class, not bolted on.

## 7. Open questions (for acceptance)

1. **Capability name** — `parametricProgram` vs `programControlFlow` vs splitting params/expr from flow.
2. **Iteration/recursion limit defaults** — `1_000_000` / `50` proposed; tune to the worker envelope (E8).
3. **System-parameter allow-list** — which `#5xxx` are worth resolving from IR state vs `0`+disclosed.
4. **Scope of `repeat`/`do-while`** — include all three loop forms in phase 2, or `while` first?

## 8. Acceptance criteria

- [ ] D1–D8 decided by the maintainer; DD marked Accepted.
- [ ] FDM + non-parametric CNC corpus **byte-identical** (fast-path gate proven).
- [ ] Parameters, expressions, and the O-word subset produce correct geometry on the parametric fixtures.
- [ ] `maxProgramIterations` + `maxCallDepth` enforced; a `while [1]` fixture stops bounded + disclosed.
- [ ] Every unsupported/limited construct surfaces a specific warning; `parametricProgram` capability honest.
- [ ] Synthetic redistributable fixtures only; a real LinuxCNC file re-checked via the harness.

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-07-29 | DD-017 drafted as **Proposed** (D1–D8 open). Phase 7 of #189; the spec-derivable RS274NGC programming layer (params/expressions/O-words) flagged during real-file validation. Follows DD-012 §16 (spec-anchored CNC). | Chestnut Labs |
| 2026-08-27 | **Phase 1 accepted & built** (parameters + expressions only; D2/D3/§5.1). New `packages/gcode-parser/src/rs274.ts` — a pure recursive-descent evaluator (RS274NGC operator/function set, degree trig, LinuxCNC MOD/EQ semantics, `MAX_EXPR_DEPTH` guard, no `eval`) + parameter store (numbered/named/global, indirect `##`, computed `#[expr]`, read-only system-param allow-list `#5420–#5422`), gated on a per-line `#`/`[` scan (FDM byte-identical, native goldens regenerated for the additive `parametricProgram` capability only; ~2.7% parse overhead from the gate, measured on 3DBenchy). O-word control flow (D4, Phases 2–4) explicitly **not** authorized until Phase 1 results are reviewed. | Chestnut Labs (lead) |
