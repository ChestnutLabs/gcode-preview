# DD-016 — Annotation-Derived Move Kinds (Wipe & Seam)

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut
**Date:** 2026-07-27 · **Last revised:** 2026-07-27
**Accepted:** 2026-07-27 — D1–D6 as recommended (D2 = the narrow additive DD-005 sink amendment; seam a non-goal). Implementation unblocked per §14.
**Owning Epic:** E9 (Toolpath Annotations & Renderer Options, #162) · **Milestone:** Future
**Supersedes / Superseded by:** none
**Related:** #182 (feature), DD-001 (`MoveKind`, capability model), DD-005 (dialect/sink contracts — the invariant this DD amends), DD-009 (annotations & renderer options — retraction-marker sibling #148), DD-010 (§3 modal-state-in-interpreter pattern). Verification evidence: [#182 comment](https://github.com/ChestnutLabs/gcode-preview/issues/182).

---

## 1. Problem

`MoveKind` reserves `Wipe` (`1 << 4`) and `Seam` (`1 << 6`), but **nothing sets them** — they are dead
bits. #182 assumed populating them was a cheap toggle like the retraction markers (#148). It is not, and
the reason is architectural, so it needs a decision before any code:

- **Retraction markers were cheap** because retraction is detectable from **motion** (E-axis reversal)
  inside the **dialect-neutral core parser** — the one layer permitted to set `kind`.
- **Wipe is not motion-detectable.** Its only reliable signal is a **slicer-specific comment**
  (`;WIPE_START` / `;WIPE_END`, the PrusaSlicer/OrcaSlicer convention emitted with "wipe while
  retracting"). That signal is seen by the **annotation layer** (dialect adapters via the
  `AnnotationSink`).
- **DD-005's sink invariant forbids the annotation layer from touching `kind`:** *"the sink exposes no
  way to touch positions, kinds, layers, or counts"* (`gcode-dialects/src/contracts.ts`). So the layer
  that can *see* the wipe signal is barred from setting the `Wipe` bit, and the layer that sets `kind`
  is dialect-neutral by design.
- **Seam has no per-move G-code signal at all** — it is implicit geometry (where a closed perimeter
  loop begins). Recovering it means a geometry heuristic, not reading a labeled move.

This DD decides **how an annotation-layer signal may set a move kind** without dissolving the DD-005
invariant that keeps adapters from rewriting geometry — and honestly scopes seam as `unavailable`.

## 2. Scope

- A **narrow, additive** mechanism by which a slicer/firmware adapter marks a segment range as `Wipe`
  (and, reserved, `Seam`), and the capability that reports it.
- Parser/IR/sink contract changes needed to carry that mark honestly.
- The renderer surface to **show or hide** wipe moves.
- A synthetic fixture (no corpus file emits the markers) and the tests that lock the behavior.

## 3. Non-goals

- **Seam detection.** No corpus or dialect signal exists; seam stays `unavailable`. A geometry-heuristic
  seam (first extrusion of each closed loop) is a *separate future DD*, explicitly not decided here.
- **Reclassifying `Extrude` / `Travel`.** This DD never lets an adapter change a move's base motion
  class; it only *adds* an orthogonal annotation bit.
- **New always-on parsing cost** for files without the markers (default parse is unchanged).
- **Color-by modal channels** (#180 / RR-002) — related modal-state work, different DD.

## 4. Decisions

> **Accepted 2026-07-27 — D1–D6 as recommended.** D2 resolves to the narrow additive DD-005 sink
> amendment (`addMoveKind`, allow-listed to `Wipe`/`Seam`); seam stays a non-goal (§3). Implementation
> proceeds on the §14 phasing.

### 4.1 D1 — Signal source (what populates the bit)

**Wipe** is populated from the `;WIPE_START` / `;WIPE_END` comment convention (PrusaSlicer/OrcaSlicer;
some configs use `; WIPE_START`). Segments emitted while "inside" a wipe bracket receive `MoveKind.Wipe`.
**Seam** has no signal → not populated (see §3). Recommended: **wipe from the comment convention; seam
deferred.**

### 4.2 D2 — Which layer sets the kind (the core decision)

Three options (weighed in §12); recommendation:

**A narrow DD-005 sink amendment — `addMoveKind(segStart, segEnd, bits)` — restricted to an additive
allow-list (`Wipe`, `Seam` only).** The adapter (which owns dialect-specific comment parsing) marks the
range; the sink ORs the allow-listed bit into `segments.kind` over `[segStart, segEnd)`. The invariant's
substance is preserved: adapters still **cannot** move positions, change layers/counts, or reclassify
`Extrude`/`Travel` — the amendment permits *only* setting orthogonal annotation bits from a fixed
whitelist, never clearing or replacing existing bits.

This keeps slicer-specific detection where DD-005 says it belongs (the dialect), rather than teaching the
core parser a slicer's comment vocabulary (rejected option, §12).

### 4.3 D3 — Capability & honesty (DD-001)

New capability `wipeMoves`: `known` when at least one wipe bracket was parsed; **`unavailable`** when the
file has no markers (the common case) — never a fabricated 0. `seamMoves` is always `unavailable` until a
future DD gives it a real source. Consumers gate any wipe UI on `capabilities.wipeMoves === 'known'`,
exactly as color-by-feature gates on `featureRoles`.

### 4.4 D4 — Renderer surface

The existing visibility toggle is **chunk-kind-based** — `setKindVisible('extrude' | 'travel')`, backed
by `GeometryChunk['kind']` (`scene.ts`). Wipe is not a chunk kind today, so this DD adds a **third chunk
kind `'wipe'`**: geometry-building splits wipe segments (kind & `Wipe`) into their own chunk, and
`setKindVisible` accepts `'wipe'`. Default **visible** (wipe moves render as today's travel-ish move until
toggled), so nothing disappears silently. The 2D renderer (E8) either honors the toggle or emits a
`renderer-unsupported` disclosure, per DD-014's capability-honesty rule.

### 4.5 D5 — Golden safety & fixtures

The golden-equivalence gate already masks the kind digest to `MoveKind.Extrude | MoveKind.Travel`
(`golden-equivalence.test.ts:78`), so adding `Wipe` bits is **byte-for-byte golden-safe** — no golden
regeneration. Because no corpus file emits the markers, correctness is proven with a **synthetic
fixture** carrying `;WIPE_START`/`;WIPE_END` around known moves.

### 4.6 D6 — Allow-list scope (guarding the amendment)

`addMoveKind` accepts **only** `Wipe` and `Seam` bits; any other bit is a contract error. This prevents
the amendment from becoming a general back-door for adapters to rewrite `kind`. Future annotation kinds
join the allow-list only by amending this DD.

## 5. Lifecycle

Wipe state is a modal boolean the adapter maintains across the parse (toggled by the bracket comments),
mirroring DD-010's "modal-state-in-interpreter" pattern. It is resolved at parse time and frozen into the
immutable IR; no post-parse mutation. The sink applies `addMoveKind` during annotation, before the IR is
sealed.

## 6. Errors & failure behavior

- Unbalanced brackets (`;WIPE_START` with no `;WIPE_END`, or nesting) → the adapter closes the open wipe
  at the next travel/extrude discontinuity or end-of-file and records a bounded diagnostic; it never
  throws and never leaves the whole file mis-marked.
- `addMoveKind` with a non-allow-listed bit or an out-of-range span → structured contract error in dev,
  ignored-with-warning in production parse (bounded failure, consistent with DD-005 sink hardening).
- Absent markers → `wipeMoves: 'unavailable'`, zero wipe bits — the honest default.

## 7. Security & resource limits

No new untrusted-input surface: the mechanism reads comment bytes already scanned by the parser and
writes only into the existing `kind` column (no new allocation per segment; the bit rides the existing
`Uint8Array`). No traversal, no expansion, no code execution. Bracket tracking is O(1) state.

## 8. Performance

Zero cost for files without the markers (the modal flag stays false; no extra columns — `Wipe` reuses
the existing `kind` byte). For files with markers, cost is one comparison per comment plus an OR per
marked segment — negligible against parse. The new `'wipe'` chunk adds at most one draw call's worth of
geometry split, bounded by the wipe segment count (small). No new budget needed; measured against the
existing parse/geometry baselines during implementation.

## 9. Testing

- **Unit (parser/adapter):** synthetic fixture with `;WIPE_START`/`;WIPE_END` → assert the bracketed
  segments carry `MoveKind.Wipe`, unbracketed do not, and `capabilities.wipeMoves === 'known'`.
- **Contract:** a file without markers → `wipeMoves: 'unavailable'`, no `Wipe` bits set.
- **Invariant:** `addMoveKind` rejects a non-allow-listed bit; never clears an existing `Extrude`/`Travel`
  bit (property check over random spans).
- **Golden:** existing golden suite stays green unchanged (kind-mask proof, §4.5).
- **Renderer:** `setKindVisible('wipe', false)` hides only the wipe chunk; extrude/travel untouched
  (mirrors the existing travel-toggle test).
- **Fixture manifest:** add `test-data/fixtures/annotations/wipe-brackets.gcode` (synthetic, MIT,
  provenance noted) — no private corpus.

## 10. Migration

Additive and backward-compatible. `MoveKind.Wipe` was already defined, so no IR schema bump for the
enum. The DD-005 `AnnotationSink` interface gains one optional method (`addMoveKind`); existing adapters
that don't implement it are unaffected. `setKindVisible`'s type widens from `'extrude' | 'travel'` to
`'extrude' | 'travel' | 'wipe'` — a superset, non-breaking for callers passing the old literals. No
consumer is required to adopt the wipe UI.

## 11. Observability / diagnostics

A parse-time counter of wipe brackets seen and a bounded warning on unbalanced brackets (privacy-
preserving — no source text, only counts and byte offsets). The `wipeMoves` capability is the primary
diagnostic surface.

## 12. Alternatives considered

- **(Rejected) Core parser recognizes `;WIPE_START/END` directly.** Simplest to code, but embeds a
  slicer's comment vocabulary in the dialect-neutral core — precisely what DD-005's plugin architecture
  exists to prevent. Would also duplicate for every future slicer variant.
- **(Rejected) Dialect-configured comment→kind hook injected into the core parser.** The adapter passes
  marker patterns the core matches. More general, but it inverts the DD-005 flow (core pulling dialect
  config) and enlarges the core's contract surface for one feature; revisit only if several kinds need it.
- **(Rejected) Geometry heuristic for both wipe and seam.** Speculative, produces `approximated` marks
  with no ground truth in the corpus; against the project's honesty rule for a launch feature.
- **(Chosen) Narrow additive sink amendment (D2).** Smallest contract change that keeps detection in the
  dialect and preserves the invariant's substance.

## 13. Risks

- **Amendment creep** — mitigated by the D6 allow-list (only `Wipe`/`Seam`; anything else is an error).
- **Convention drift** — a slicer changes its wipe comment; mitigated by keeping the pattern in the
  adapter (one place to update) and capability-gating so a miss degrades to `unavailable`, not wrong.
- **No real corpus coverage** — mitigated by the synthetic fixture; flagged as a known limitation until a
  marker-emitting file enters the corpus.

## 14. Phased delivery

1. **DD-005 sink amendment + IR/capability plumbing:** `addMoveKind` (allow-list), `wipeMoves` capability,
   synthetic fixture + parser/contract tests. No renderer change yet.
2. **Renderer `'wipe'` chunk + `setKindVisible('wipe', …)`** and the adapter prop passthrough; renderer
   test.
3. **Seam:** documentation-only — record `unavailable` and the future geometry-heuristic DD pointer.

## 15. Acceptance criteria

- [ ] `MoveKind.Wipe` is set on exactly the segments inside `;WIPE_START`/`;WIPE_END` for the synthetic
      fixture; `capabilities.wipeMoves === 'known'`.
- [ ] A file without markers yields no `Wipe` bits and `wipeMoves: 'unavailable'`.
- [ ] `AnnotationSink.addMoveKind` accepts only `Wipe`/`Seam`; every other bit is a contract error; it
      never clears `Extrude`/`Travel`.
- [ ] The existing golden-equivalence suite passes **without regeneration**.
- [ ] `setKindVisible('wipe', false)` hides only wipe geometry; extrude/travel visibility is untouched.
- [ ] `seamMoves` is documented as `unavailable`; no fabricated seam data ships.
- [ ] No core package depends on AnyBridge; slicer-specific detection stays in `gcode-dialects`.

## Decision log

| Date | Note | Source |
|---|---|---|
| 2026-07-27 | DD-016 drafted as **Draft**; D1–D6 open. Motivated by #182 verification: `Wipe`/`Seam` bits are defined but never set, wipe's only signal is a slicer comment the DD-005 sink invariant bars the annotation layer from turning into `kind`, and seam has no per-move signal. Proposes a narrow additive sink amendment (`addMoveKind`, allow-listed to `Wipe`/`Seam`) so detection stays in the dialect while the invariant's substance holds; scopes seam as `unavailable`. Numbered DD-016 because DD-011 (`.bgcode`, #188) and DD-012 (CNC/laser, #189) are reserved, DD-013/DD-014 are taken, and DD-015 is the RR-002 modal-color-channels candidate (#180). | Chestnut Labs |
| 2026-07-27 | **Accepted — D1–D6 as recommended.** D2 = the narrow additive DD-005 sink amendment (`addMoveKind`, allow-listed to `Wipe`/`Seam`); seam confirmed a non-goal. Implementation unblocked on the §14 phasing (1: sink amendment + `wipeMoves` capability + synthetic fixture + parser/contract tests; 2: renderer `'wipe'` chunk + `setKindVisible('wipe', …)` + adapter passthrough; 3: seam docs). | Maintainer (Chestnut Labs) |
