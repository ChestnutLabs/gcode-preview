# DD-010 — Motion-Model Correctness (Extruder Mode, Positioning Mode, Arc Planes, Coordinate Systems)

**Status:** **Proposed** <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Chestnut Labs
**Date:** 2026-07-24 · **Last revised:** 2026-07-24
**Owning Epic:** proposes **E10 — Motion-Model Correctness** (post-`v0.1.0`) · **Milestone:** Future
**Supersedes / Superseded by:** none
**Related:** DD-001 (IR + capability model — `capabilities` map, floating origin §4.6, the position/extrusion channels these changes alter), DD-003 (§14 the byte-exact parse core in `packages/gcode-parser/src/parse.ts` and its golden-equivalence gate — the gate these changes deliberately touch), DD-005 (dialect adapter contract — where firmware-default hints for the unspecified-mode fallback would live), DD-006 (progress mapper — consumes segment positions + extrusion distance, must be re-validated), DD-009 **§3 Non-goals** (which explicitly carved these out: "*a separate DD: those change the interpreter's position semantics … they alter existing IR output, not add optional surfaces*"); the **#154 audit** (`docs/compatibility/gcode-motion-coverage.md`); tracking issues **#155** (G90/G91 + G92 motion state), **#156** (M82/M83 extruder mode), **#157** (G17/G18/G19 arc planes), **#158** (G53/G54–G59 coordinate systems).

---

> DD-009 §3 deferred motion-model correctness to a separate DD because these fixes are contract-sensitive in a **different** way from the E9 annotation work: E9 items are additive/opt-in surfaces that leave existing IR byte-identical, whereas **#155–#158 alter the interpreter's position and extrusion semantics and therefore change existing IR output**. This DD makes those decisions once, coherently, so implementation proceeds phased with the same discipline as E1–E7 — but with an explicit golden-regeneration strategy (D5) because the golden-equivalence gate that protected every prior parser change is, for these fixtures, the thing being intentionally moved.
>
> **None of these were `v0.1.0` blockers** — the audit shipped them as documented known limitations. This is post-release correctness work.

> **Awaiting maintainer acceptance — D1–D6 open.** §14's phased plan assumes the recommendations.
>
> *Note: the `parse.ts` line numbers cited below are as of this DD's authoring analysis and are
> illustrative pointers to the relevant functions/logic; they drift as the file changes (e.g. the
> #147 `M600` handler shifted the dispatch switch). Implementation targets the then-current code.*

---

## 1. Problem

The parser/interpreter (`@chestnutlabs/gcode-parser`, `packages/gcode-parser/src/parse.ts`) is a **byte-exact port of the inherited xyz-tools engine** whose module header (lines 1–17) states the fidelity contract plainly: "*Deliberate quirk-for-quirk fidelity … is required by the golden-equivalence gate; do not 'fix' behavior here without a reviewed golden regeneration.*" That port inherited the upstream engine's **motion-model gaps**, catalogued by the #154 audit.

The audit's coverage table (`gcode-motion-coverage.md` lines 20–24) records four position-affecting gaps, verbatim:

- "**`G90` / `G91`** … **NOT honored — always absolute**"
- "**`G92`** … **NOT honored**"
- "**`M82` / `M83`** … **NOT honored — raw E treated as delta**"
- "**`G17` / `G18` / `G19`** … **NOT honored — arcs assume XY**"
- "**`G53` / `G54`–`G59`** … **NOT honored**"

with reproductions (lines 30–33) including "*[M82] abs-E: an E-unchanged move is classified EXTRUDE (should be TRAVEL); extrusion distance inflated*" and "*[G91] relative: `G1 X10` then `G1 X10` after `G91` → ends X=10 (should be 20 …)*".

**Where this lives in the code today.** `createEngine`'s machine-state block (`parse.ts` lines 254–267) tracks `sx/sy/sz`, `tool`, `units`, `modalFeed`, and the floating origin `ox/oy/oz` — and **no** extruder-mode flag, **no** positioning-mode flag, **no** arc-plane selector, and **no** work-offset vector. Consequently:

- **Extrude vs travel** is classified from the raw `E` word: `const pathType = e > 0 ? 'extrusion' : 'travel';` (line 438) and the arc equivalent `const pathType = e ? 'extrusion' : 'travel';` (line 453). The segment's stored extrusion is the **raw** `e ?? 0` (line 446), and `stats.extrusionDistance += e` (line 442) sums raw `E`. This is only correct if `E` is **relative** (a per-move delta). Under **M82 (absolute E)** — the Marlin firmware default — `E` is a monotonically increasing running total, so `e > 0` is true for nearly every move: **travel moves are misclassified as extrusion and the extrusion distance is inflated by roughly the cumulative filament length** (audit line 32).
- **XYZ is always absolute**: `sx = x ?? sx; sy = y ?? sy; sz = z ?? sz;` (lines 443–445). `G90`/`G91` fall through the `processLine` switch (lines 538–574) to the `default` branch, which merely warns `unsupported-command` (lines 572–573) and drops them. Relative moves accumulate wrong (audit line 30).
- **Arcs assume the XY plane**: `g2` (lines 449–513) reads only `i`/`j`, computes `centerX = sx + i`, `centerY = sy + j` (lines 473–474), interpolates `px/py` with `cos/sin` (lines 504–505), and linearly ramps Z (lines 492–493). `K` is never read; `G17`/`G18`/`G19` hit the `default` warn. The R-mode chord solve (lines 459–470) is likewise XY-only, and line 460 is annotated "*assume abs mode (inherited)*".
- **Work-coordinate offsets are ignored**: `G53`, `G54`–`G59`, and `G92` all fall to the `default` warn. `G92 X0` at physical X50 does not shift the datum (audit line 31); `G28` merely hard-zeros `sx/sy/sz` (lines 557–561).

These are **inherited limitations, not regressions** (audit lines 47–50). But fixing any of them changes interpreter motion state → IR segment positions and extrusion deltas → the `moveKind` classification (`capabilities.moveKind` is `'known'`, line 615), the layer index, and every downstream consumer (renderer coloring, DD-006 progress). They cannot be built ad-hoc under the docs-first rule, and they cannot ride the golden gate unchanged. Hence this DD.

## 2. Scope

Four position-affecting behaviors, one decision each for the mechanics (D1–D4), plus one meta-decision for how to alter golden-gated output honestly (D5) and one for sequencing (D6). All changes are confined to the interpreter engine in `packages/gcode-parser/src/parse.ts` plus additive capability disclosure in the IR header and its consumers.

| Behavior | Issue | This DD |
|---|---|---|
| M82/M83 extruder absolute/relative + extrude/travel reclassification | **#156** (highest impact) | **D1** |
| G90/G91 positioning mode for XYZ, and its independence from E-mode | **#155** | **D2** |
| G17/G18/G19 arc-plane selection | **#157** | **D3** |
| G53/G54–G59 coordinate systems + G92 offsets + floating-origin interaction | **#158** (+ #155's G92 half) | **D4** |
| Golden discipline + capability honesty while altering existing output | (cross-cutting) | **D5** |
| Phasing | (cross-cutting) | **D6** |

## 3. Non-goals

- **Adding motion codes that do not affect emitted geometry** — e.g. `G4` dwell (audit line 25: "*n/a (not position-affecting)*"). Out of scope; no IR consequence.
- **Firmware auto-detection** as a correctness crutch. Sniffing whether a file "looks Marlin" to guess the unspecified-mode default is explicitly rejected (D1 Option C, D5); any firmware-default hint belongs in the DD-005 dialect layer as an explicit, capability-tagged input, not a heuristic in the byte-exact engine. (This is the *same* `extrusionMode`/`positioningMode` hint D2's precedence consumes.)
- **CNC / laser / plotter non-extrusion move-modelling (#189).** DD-010's extrude-vs-travel classification stays **E-based** (`eDelta > 0 ? Extrude : Travel`), so a zero-E laser/mill/plotter file remains 100 % `Travel` even *after* DD-010. Cut-vs-rapid classification without an E axis, plus a spindle/laser tool-state channel, is a **sibling DD** (proposed **DD-012**, owning epic **#189**) that **depends on and extends** the classifier DD-010 rewrites — sequenced *after* DD-010, never merged into it (reconcile by scoping, not duplication). DD-010 deliberately lays groundwork the sibling reuses: the WCS table `G53`/`G54`–`G59` (D4), arc planes `G17`/`G18`/`G19` (D3), and the modal-state-in-interpreter pattern. (`.bgcode` container decode, epic **#188** → proposed DD-011, is likewise its own DD and unrelated to motion.)
- **Renderer/adapter surface changes.** These fixes change what the IR *contains*, not the renderer's public API. The renderer consumes the corrected positions/kinds through the existing channels; no new renderer option is proposed here (contrast DD-009, which was all renderer/adapter surface).
- **Anything that ships before the corpus is re-validated.** A phase does not merge until its golden strategy (D5) is executed.

> **Design note — shared modal-channel layer.** The "*modal state tracked in the interpreter → emitted
> as a per-segment or sparse side channel*" mechanism DD-010 introduces (extrusion mode, positioning
> mode, arc plane, WCS) is the **same** pattern that #180 (advanced color modes — fan/temp/accel/PA/flow)
> and #189 (spindle/laser tool-state) will reuse. DD-010's implementation should keep that mode-tracking
> + channel-emission seam **generic** rather than hard-wired to M82/M83, so the later DDs extend it
> instead of re-inventing it. Design the modal-channel layer once.

## 4. Decisions

Marked **D1–D6**; each lists options with a recommendation. D1 and D2 share one piece of modal machinery and are recommended to land in the same phase (see D6).

### 4.1 D1 — M82/M83 extruder absolute/relative mode, and extrude/travel reclassification (#156) · REVISED (firmware-correctness)

> **Revision (2026-07-24, maintainer feedback).** The first draft recommended defaulting the
> unspecified extruder mode to **relative** and letting D2's "E follows G90/G91" apply universally.
> Both were wrong: (a) they are internally in tension, and (b) they are not firmware-universal —
> **Marlin/Klipper** power on in *absolute* and let `G90`/`G91` steer E **until** `M82`/`M83` latch it,
> whereas **RepRapFirmware** treats XYZ and E **independently** (`G90`/`G91` never touch E). The draft's
> "relative keeps the corpus byte-identical" justification was also mis-attributed — the corpus is
> byte-identical because every fixture emits `M83` *explicitly*, not because of the default. D1 below
> now (a) defaults the unspecified mode to **absolute** (the firmware-neutral power-on convention,
> disclosed `inferred`), and (b) hands the firmware-conditioned `G90`/`G91`↔E interaction to D2. The
> corpus stays byte-identical for the right reason.

**Today.** No extruder-mode state exists (state block lines 254–267). Classification, the stored per-segment extrusion, `stats.extrusionDistance`, and the E-only retraction events (lines 419–435, where `kind: e < 0 ? 'retract' : 'unretract'`, line 428) all read the **raw** `E` word as if it were a per-move delta. Under **M82** that word is an absolute cumulative position, so the classification inverts (travel→extrude) and extrusion distance inflates — the audit's highest-impact finding (`gcode-motion-coverage.md` lines 38–41): "*M82 (absolute extrusion) is the highest-impact gap … Modern slicers that emit M83 (relative E) are unaffected — including the fixtures in our corpus, which is why the demo renders correctly.*"

The fix is to compute a **true per-move E delta** from a modal extruder mode and reclassify on the delta:

```
eDelta = eAbsolute ? (eParam - lastE) : eParam
kind   = eDelta > 0 ? Extrude : Travel     // XYZ-move case
lastE  = eAbsolute ? eParam : lastE + eParam
```

and route `eDelta` (not raw `E`) into `emitSegment` (line 446), `stats.extrusionDistance` (line 442), and the E-only retraction sign (lines 420–431). This requires maintaining `lastE` and honoring `G92 E<v>` datum resets (D4) so the first extruding move after a `G92 E0` computes a sane delta.

- **Option A (recommended): track `M82`/`M83` as explicit modal state; default the *unspecified* mode to `absolute` (the firmware power-on convention), disclosed `inferred`.** Add `eMode: 'unset' | 'absolute' | 'relative'` + `lastE: number` to the state block; `M82`→`absolute`, `M83`→`relative`. The **effective** mode resolves by the precedence pinned in D2: (1) explicit `M82`/`M83`; (2) a firmware-conditioned `G90`/`G91` interaction (D2); (3) the firmware default = **absolute**. All three firmware families (Marlin, RepRapFirmware, Klipper) power on in absolute extrusion, so absolute is the honest firmware-neutral fallback when nothing is stated — disclosed `capabilities.extrusionMode: 'inferred'`, never silently asserted `'known'`. **Corpus stays byte-identical:** every existing fixture emits `M83` *explicitly* → resolves to `'known'` relative → the current output; the default (step 3) only ever fires for files that state *neither* a mode command *nor* a firmware-known `G90`/`G91`, none of which are in the corpus.
- **Option B: default to relative when unspecified** (the original draft). Rejected on the firmware correction above — it contradicts the Marlin/RRF/Klipper power-on convention, and its "keeps the M83 corpus byte-identical" rationale was mis-attributed (the corpus is explicit-`M83`, so the default never touches it). Relative-as-default would mis-read a hand-written absolute-E Marlin file that omits the mode word.
- **Option C: heuristic detection** (sniff monotonic vs. resetting E). Fragile, un-golden-able, violates the byte-exact engine's no-heuristics posture. The firmware default is instead **disclosed** as inferred, and refined by an *explicit* dialect-layer firmware hint (D2), not sniffed. Rejected.

**Recommendation: Option A.** Model `M82`/`M83` explicitly, default the unspecified mode to **absolute** (disclosed `inferred`), and reclassify extrude/travel + recompute `stats.extrusionDistance` and the retraction-event kinds from the resolved `eDelta`. Blast radius: `capabilities.moveKind` stays `'known'` but its **values change** for M82 files — the renderer's travel/extrude coloring and DD-006 progress are re-validated (D5). The `G90`/`G91`↔E interaction and the full resolution precedence are pinned in D2.

### 4.2 D2 — G90/G91 positioning mode for XYZ, and the firmware-conditioned E-mode interaction (#155) · REVISED

**Today.** XYZ is unconditionally absolute (`sx = x ?? sx …`, lines 443–445; arc R-mode comment line 460 "*assume abs mode*"). `G90`/`G91` are dropped by the `default` warn.

**The requirement, corrected for firmware divergence (maintainer feedback, 2026-07-24).** `G90`/`G91`
**always** set the XYZ positioning mode; whether they **also** set the extruder mode is **firmware-
specific**: **Marlin/Klipper** let `G90`/`G91` steer E **until** `M82`/`M83` latch it, whereas
**RepRapFirmware** treats E **independently** — `G90`/`G91` never touch E in RRF. So the model is one
universal `xyzAbsolute` flag plus a **firmware-conditioned** resolution of the effective E-mode (the
precedence that also removes the D1/D2 tension):

- `xyzAbsolute` — set by `G90`(true)/`G91`(false); consumed when updating `sx/sy/sz` and when computing arc target deltas. **Universal** across firmware.
- **Effective E-mode** (used by D1's `eDelta`) resolves by precedence:
  1. explicit `M82`/`M83` seen → latched; `extrusionMode: 'known'`.
  2. else, **only when the DD-005 dialect layer reports a Marlin-family firmware** *and* a `G90`/`G91` has been seen → E follows `xyzAbsolute` (`'known'` when the firmware hint is `'known'`, else `'inferred'`).
  3. else → firmware default = **absolute**; `extrusionMode: 'inferred'`.

- **Option A (recommended): universal `xyzAbsolute` + the firmware-conditioned E-mode precedence above.** `G90`/`G91` write `xyzAbsolute` (relative XYZ becomes `sx += x ?? 0`, arcs compute the target from `sx + (x ?? 0)`). The `G90`/`G91`→E step (2) fires **only** under a Marlin-family DD-005 hint; under RepRapFirmware — or when the firmware is unknown — `G90`/`G91` are **XYZ-only** and E falls to step 3 (absolute, inferred). This handles the common slicer shape (`G90` + explicit `M83`) *and* the divergent firmware conventions, and the byte-exact engine never sniffs firmware itself — the hint is an explicit DD-005 input (DD-005 already classifies Marlin/RepRap/Klipper).
- **Option B: a single positioning flag for all axes.** Rejected — wrong for `G90` + `M83` (would force E absolute) and wrong for RRF (would make `G90`/`G91` touch E).
- **Option C: apply the Marlin `G90`/`G91`→E rule universally** (the original D2 draft). Rejected on the firmware correction — wrong for RepRapFirmware's independent E.

**Recommendation: Option A.** **D1 and D2 are one modal machine and land together.** When no firmware is detected, the conservative resolution is XYZ-only + absolute-E-`inferred`. Disclose `capabilities.positioningMode: 'known'|'inferred'` and `extrusionMode` per the precedence. **#155** (reopened as the E10 child) owns the G90/G91 *mode* half here and its G92 *offset* half in D4.

### 4.3 D3 — G17/G18/G19 arc-plane selection (#157)

**Today.** `g2` (lines 449–513) is hardwired to XY: center from `i`/`j` (lines 473–474), `cos/sin` into `px/py` (lines 504–505), linear Z ramp (lines 492–493), XY-only R-mode chord (lines 459–470). `K` is captured by the lexer (`lexLine` accepts any letter, lines 172–178) but never consumed. `G17`/`G18`/`G19` fall to the `default` warn. Audit line 33: "*[G18] XZ arc: flattened with XY (I/J) interpretation; K ignored.*"

- **Option A (recommended): a modal `arcPlane` selector (`G17`=XY default, `G18`=XZ, `G19`=YZ) with a plane-parameterized `g2`.** Refactor the arc math to operate on an abstract (`u`, `v`) in-plane pair with a linear `w` ramp, mapping (u,v,w)→(x,y,z) per plane: XY uses (I,J)/K-linear, XZ uses (I,K)/J-linear, YZ uses (J,K)/I-linear. `G17` reproduces today's output **exactly** (same offset params, same interpolation), so the XY-arc corpus goldens are unchanged; only G18/G19 arcs (CNC) newly render correctly. Generalize the R-mode chord solve to the active plane's two axes.
- **Option B: XY + XZ only, defer YZ.** Partial honesty — leaves a silently-wrong plane. Rejected; the three planes are symmetric, so doing two is not meaningfully cheaper than three.
- **Option C: keep XY-only, but *warn* on G18/G19 and mark capability `unavailable`.** A stop-gap that's honest but not a fix. Acceptable only as a phase-boundary intermediate, not the end state.

**Recommendation: Option A.** Disclose `capabilities.arcPlanes: 'known'` once a plane word is seen (default `'inferred'` = XY assumed). Emphasize: because segment vertices for non-XY arcs change, the renderer's arc geometry and bounds must be re-validated on new G18/G19 fixtures (D5).

### 4.4 D4 — Coordinate systems G53/G54–G59 + G92 offsets, and floating-origin interaction (#158)

**Today.** No work-offset state. `G53`, `G54`–`G59`, and `G92` all fall to `default` warn; `G28` hard-zeros `sx/sy/sz` (lines 557–561). Audit line 31: "*[G92] offset: `G92 X0` at physical X50, then `G1 X10` → ends X=10 (should be physical X=60).*" The **floating origin** (DD-001 §4.6) is captured at the first emitted segment's start position (`originSet`/`ox/oy/oz`, lines 264–267 + 307–312) and every segment/retraction is rebased by subtracting it (lines 315–320, 652–659) — so whatever frame the interpreter tracks flows directly into the origin and the rebased output.

The core design question is **which frame the IR represents**. G54–G59 select a work-coordinate system (a per-system XYZ offset table); G53 is a one-shot "this line is in machine coordinates"; G92 sets an offset so the *current* commanded position equals a given value (it moves the datum, not the tool) and `G92 E<v>` resets the extruder datum (which D1's `lastE` must honor). Slicer FDM files use the identity WCS, which is exactly why today's "ignore offsets" happens to be correct for the corpus — so, like D1/D3, a correct model must reproduce current output when offsets are absent.

- **Option A (recommended): model an active work offset (WCS table entry for G54–G59, composed with the G92 offset vector); apply it to commanded coordinates to obtain the *logical* position that feeds geometry; treat G53 as a one-shot bypass for its line.** Maintain `activeWcs` (index into a small G54–G59 offset table, default G54=identity), a `g92off` per-axis vector (X/Y/Z **and** E), and compute the logical position as `commanded + wcsOffset + g92off`. `G92 X<v>` sets `g92off.x = currentLogical.x − v` (datum shift, no motion); `G92 E<v>` sets the extruder datum so D1's `lastE` rebases. The IR stays in this **logical/work frame** — what the operator sees and what a slicer already emits (identity → byte-identical to today). The floating origin (lines 307–312) then captures the first emitted *logical* position, so segments and retractions remain mutually consistent with no change to the rebasing code.
- **Option B: track machine coordinates in geometry and expose the active offset only as header metadata.** Keeps a "truer" machine frame but makes the *preview* jump to machine origin for any file using a non-identity WCS — visually wrong for the exact users who set G54. Rejected.

**Recommendation: Option A.** Disclose `capabilities.coordinateSystem: 'known'` when any G53/G54–G59/G92 is seen, else `'inferred'` (identity). **Phasing nuance:** `G92 E0` is routinely emitted by slicers that also use `M82`, so the **E-axis datum reset must land with D1/D2 in phase 1**; full XYZ WCS + G53 + G92 XYZ can follow in phase 3 (D6). This split keeps #156 shippable without waiting on the whole coordinate-system model.

### 4.5 D5 — Preserving golden-fixture discipline and capability honesty while altering existing output

This is the decision that distinguishes E10 from E9. Every prior parser change rode the **golden-equivalence gate** (`parse.ts` header lines 15–17). These changes deliberately move that gate for affected fixtures, so we need an explicit, reviewable strategy that keeps DD-001 capability-honesty intact.

Sub-decisions and recommendations:

- **Default-correct, not opt-in.** DD-009 items were opt-in because they were optional *surfaces*. Motion mode cannot be a per-file runtime toggle (there is no one to ask "is your E absolute?"); the only honest behavior is to **honor the codes actually present**. Crucially, "default-correct" here is nearly non-disruptive: for files that never use the previously-ignored codes (the M83/XY/identity-WCS corpus), the recommended options (D1-A, D2-A, D3-A, D4-A) all reduce to **byte-identical output**. The change manifests *only* for files that exercise the newly-honored codes. **Recommendation: default-correct.**
- **Capability flags for every altered dimension.** Extend the `capabilities` record (`parse.ts` lines 612–623) with `extrusionMode`, `positioningMode`, `arcPlanes`, and `coordinateSystem`, each `Confidence`-typed: `'known'` when the governing command was observed, `'inferred'` when we defaulted (relative-E / absolute-XYZ / XY-plane / identity-WCS), `'unavailable'` for a dimension a given phase has not yet modeled. This upholds DD-001 ("*never fabricate a 0*") — an inferred default is disclosed as inferred, not asserted as known.
- **Golden-regen strategy = "prove-unchanged + one new golden per code."** (a) **Freeze** the existing corpus and assert it stays byte-identical under each phase — this is the regression guard that the change is truly scoped to the newly-honored codes. (b) **Add targeted fixtures** exercising each new behavior — M82, M82+`G92 E0`, `G91` XYZ, `G91`+`M83` mixed, G18 and G19 arcs (incl. R-mode), G54 offset, `G92 X` datum shift — each with a freshly generated golden **reviewed against hand-computed expected positions and against the audit's repro cases** (`gcode-motion-coverage.md` lines 30–33). (c) For any pre-existing fixture that legitimately changes, regenerate with a **documented diff + rationale** in the PR. **Recommendation: this split**, mirroring the reviewed-golden-regeneration rule in the parser header.
- **Mandatory downstream re-validation.** Because these alter `moveKind` values, segment vertices, extrusion deltas, and the layer index, each phase must re-run: renderer travel/extrude coloring + arc-geometry + bounds snapshots (`gcode-renderer-three`), the DD-006 progress mapper (extrusion-distance/live-progress), and the portable behavioral suite exported from `gcode-preview-core`. **Recommendation: gate each phase on these re-validations, listed in its acceptance criteria.**

### 4.6 D6 — Phasing

- **Option A (recommended): M82/M83 first, then arcs, then coordinate systems.**
  1. **Phase 1 — modal machinery (D1 + D2 + G92 E-datum from D4):** the highest-impact fix (#156 M82; #155 G90/G91). D1 and D2 share one modal machine and land together; the `G92 E0` datum reset rides along because slicer M82 files depend on it.
  2. **Phase 2 — arc planes (D3, #157):** self-contained refactor of `g2`; touches only arc fixtures.
  3. **Phase 3 — full coordinate systems (D4, #158 + #155's G92-XYZ half):** G53/G54–G59 table, G92 XYZ datum, floating-origin interaction; the largest new state model, lowest FDM prevalence.
- **Option B: single big-bang PR.** Rejected — un-reviewable golden diff, and it couples the common-case M82 fix to the rare CNC coordinate-system work.

**Recommendation: Option A**, matching the audit's own priority call (`gcode-motion-coverage.md` lines 52–56: "*prioritize #156 (M82) and #155 (G91/G92) early*"). Each phase is an independently shippable PR train with its own golden regen (D5).

## 5. Lifecycle

On acceptance: open **E10 — Motion-Model Correctness** (milestone Future) owning **#155/#156/#157/#158**, and file the phased implementation issues per §14. Each phase is an independently reviewable PR with tests, a **golden regeneration** (D5), a Changeset entry (folds into the accumulating 0.2.0 — lockstep across all nine `@chestnutlabs/*` packages), and downstream re-validation. No release-flow changes.

## 6. Errors & failure behavior

- **Honest degradation per DD-001.** Until a phase lands, the corresponding dimension is disclosed `'inferred'` (defaulted) or `'unavailable'`, never silently "known-correct." The existing `unsupported-command` warning (lines 572–573) is *replaced*, per code, by actual handling as each phase lands — so a `M82` that used to warn-and-drop now updates state; a not-yet-implemented `G59.3` still warns.
- **Malformed/edge inputs stay bounded.** New modal state adds a handful of scalars; it does not touch the growable `SegmentWriter` budgets or the `StopReason` limit paths (lines 298–355). A `G91` before any absolute reference simply accumulates from 0 (the current origin), matching firmware. A `G92` with no prior position sets the datum against 0.
- **Arc degeneracy** in non-XY planes reuses the existing guards (`totalSegments < 1 → 1`, line 488; whole-circle detection, line 472) applied in the active plane.

## 7. Security & resource limits

No new untrusted-input surface: all state is derived from the already-lexed command stream. Added state is O(1) scalars (two mode flags, `lastE`, a fixed 6-entry WCS offset table, one G92 offset vector) — negligible against the existing per-parse budgets in `ParseLimits` (lines 44–58). The arc-plane refactor does not change the per-arc segment count formula (lines 486–488), so `maxSegments` bounds are unaffected.

## 8. Performance

Per-line cost gains a couple of branches (mode check, offset add) and, for absolute E, one subtraction per move — immeasurable against lexing (`lexLine`, lines 161–181) and the SoA writes. Arc interpolation cost is unchanged (same trig, re-parameterized axes). No new allocation in the hot path.

## 9. Testing

- **Unit fixtures** per D5: byte-identical assertions over the frozen corpus, plus new goldens for M82 / M82+`G92 E0` / `G91` / `G91`+`M83` / G18 / G19 / G54 / `G92 X`, each hand-verified against the audit repros (`gcode-motion-coverage.md` lines 30–33).
- **Classification assertions:** an E-unchanged move under M82 is `Travel` (audit line 32); extrusion distance equals summed deltas, not raw cumulative E.
- **Portable behavioral suite** (`gcode-preview-core` `/testing`) re-run for all three adapters to confirm no parity drift.
- **Downstream:** `gcode-renderer-three` snapshot tests (coloring, arc geometry, bounds) and the DD-006 progress mapper.

## 10. Migration

Output changes only for files that use the previously-ignored codes, and only toward correctness. The new behavior is disclosed through the `capabilities` map (D5), and any fixture whose golden changes ships with a migration note under the DD-002 §8 rule. Consumers that pinned to the (incorrect) prior positions of an M82 file get a documented diff. No API signature changes.

## 11. Observability / diagnostics

The new `capabilities` keys (`extrusionMode`, `positioningMode`, `arcPlanes`, `coordinateSystem`) are the primary diagnostic surface: a consumer can read exactly which motion dimensions were observed vs. inferred. Existing warnings are reused; the per-code `unsupported-command` warning shrinks as each phase adds real handling. No new diagnostics channel.

## 12. Alternatives considered

Covered per decision (§4). Cross-cutting alternative — **leave the gaps documented and never fix them** (the `v0.1.0` posture): rejected for the common cases (M82 is a Marlin default; audit lines 38–39), accepted only as the pre-E10 status quo. Cross-cutting alternative — **implement ad-hoc without a DD**: rejected because these alter golden-gated contract output, precisely the case DD-009 §3 reserved for a separate DD.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Golden regen hides an unintended change beyond the targeted code | D5 "prove-unchanged" freeze of the existing corpus as a regression guard; every new golden hand-verified against audit repros |
| Wrong default for unspecified E-mode | D1 Option A defaults to **absolute** (the Marlin/RRF/Klipper power-on convention), disclosed `'inferred'`, never asserted `'known'`; the corpus is byte-identical because it is explicit-`M83`, not because of the default |
| Firmware-specific `G90`/`G91`↔E interaction modeled wrong (Marlin vs RepRapFirmware) | D2 Option A gates the `G90`/`G91`→E step on an explicit DD-005 Marlin-family hint; RRF/unknown ⇒ XYZ-only; fixtures for `G90`+`M83` (Marlin) and a RRF `G90` file |
| Downstream renderer/progress silently mis-render changed positions | D5 gates each phase on renderer snapshot + DD-006 + behavioral-suite re-validation |
| G92/WCS frame choice makes previews jump to machine origin | D4 Option A keeps the IR in the logical/work frame (identity → unchanged); machine-frame Option B rejected |
| Scope creep from CNC-only features into the common FDM path | D6 phases common-case M82/G91 first; CNC coordinate systems last, independently shippable |

## 14. Phased delivery (proposed, impact-first)

1. **Modal machinery — M82/M83 + G90/G91 + G92 E-datum** (D1, D2, D4-E half; #156, #155): `xyzAbsolute` + tri-state `eMode` resolved by the D2 precedence (explicit `M82`/`M83` → firmware-conditioned `G90`/`G91` → absolute default), `lastE`, delta-based extrude/travel reclassification, extrusion-distance + retraction-event recompute, relative-XYZ updates — built on a **generic mode→channel seam** (§3 design note) rather than M82/M83-specific plumbing, so DD-011/DD-012 extend it. New capabilities `extrusionMode`, `positioningMode`. Golden regen + downstream re-validation.
2. **Arc planes — G17/G18/G19** (D3; #157): plane-parameterized `g2`, `K` consumption, per-plane R-mode. New capability `arcPlanes`.
3. **Coordinate systems — G53/G54–G59 + G92 XYZ** (D4; #158, #155 G92 half): active WCS table, G92 offset vector, G53 one-shot bypass, floating-origin interaction. New capability `coordinateSystem`.

## 15. Acceptance criteria

- [ ] D1–D6 decided by the maintainer and recorded verbatim; DD marked Accepted
- [ ] **E10 — Motion-Model Correctness** opened (milestone Future) owning #155/#156/#157/#158, with phased issues per §14
- [ ] Phase 1: M82 file classifies E-unchanged moves as **Travel** and reports delta-summed extrusion (audit repro line 32 resolved); `G91` repro (audit line 30) resolved; the firmware-conditioned `G90`/`G91`↔E interaction covered (Marlin `G90`+`M83` and a RepRapFirmware `G90` file); unspecified E-mode defaults to **absolute** disclosed `inferred`; frozen corpus byte-identical; renderer + DD-006 + behavioral suite re-validated
- [ ] Phase 2: G18/G19 arcs interpolate in the correct plane with `K` honored (audit line 33 resolved); XY-arc corpus byte-identical
- [ ] Phase 3: `G92`/G54–G59 offsets honored (audit repro line 31 resolved); identity-WCS corpus byte-identical; floating-origin consistency verified
- [ ] Every altered dimension disclosed via a `Confidence`-typed capability (`known`/`inferred`/`unavailable`); no fabricated `known`
- [ ] Each phase: default-correct (no runtime opt-in), reviewed golden regeneration, Changeset entry, no adapter parity drift

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-07-24 | DD-010 drafted as **Proposed**; D1–D6 open. Split from DD-009 §3 (motion-model correctness carved out as a separate DD). Grounded in the #154 audit (`docs/compatibility/gcode-motion-coverage.md`) and the byte-exact interpreter in `packages/gcode-parser/src/parse.ts`. Proposes **E10 — Motion-Model Correctness** owning #155/#156/#157/#158 | Chestnut Labs |
| 2026-07-24 | **D1 + D2 revised (maintainer feedback)** — unspecified E-mode now defaults to **absolute** (the Marlin/RRF/Klipper power-on convention), not relative; the `G90`/`G91`→E interaction is **firmware-conditioned** (Marlin/Klipper vs RepRapFirmware-independent) via an explicit DD-005 hint, resolved by a stated precedence that removes the D1/D2 tension. Added a §3 non-goal + design note scoping **CNC/laser (#189) as a sibling DD (proposed DD-012) sequenced after DD-010** (reconcile by scoping, not merging), noting `.bgcode` (#188 → DD-011), and the shared modal-channel pattern (#180/#189). Still **Proposed** — awaiting acceptance of revised D1–D6 | Maintainer feedback + Chestnut Labs |
| _pending_ | Awaiting maintainer decision on D1–D6 and on opening E10 | Maintainer |