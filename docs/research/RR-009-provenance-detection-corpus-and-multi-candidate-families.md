# RR-009 — Provenance detection: a multi-candidate slicer/controller-family model & corpus

**Status:** In progress <!-- In progress | Complete | Superseded --> · **scope-only** (draft the plan; the
detector itself is a future epic, not authorized to build)
**Authors/Owners:** Nathaniel Chestnut (drafted by Claude, project lead)
**Date:** 2026-08-27
**Related:** DD-005 (dialect plugin & container-adapter contracts — the current `detect()` surface),
RR-004 §7 (spec landscape), RR-007 (cross-slicer marker research), DD-026 (slicer object/feature
capture — a consumer of correct family detection). `#189` evidence-based CNC detection (#258) is the
closest prior art.

---

> **Why this RR exists.** The owner asked for a *grounded plan* for multi-candidate slicer-family
> detection, to stay a scoped future capability until there is enough real provenance data and a concrete
> need. This record defines the question, audits today's behaviour, proposes a model to evaluate, and
> lists what the future epic must gather — **without building the detector**.

## 1. Question & the decision it informs

**Question.** Should the library's dialect detection move from **single-winner-per-kind** to a
**multi-candidate, confidence-ranked** model with an explicit *ambiguity* signal, and what real-file
corpus would validate it? The decision it informs: whether to open a "provenance detection" epic, and
if so, what public shape the detection result takes (a ranked candidate set vs. today's single decision).

**Why it matters.** Slicer families are **derivative and share markers**, so a single winner is often
wrong or discarded:
- OrcaSlicer, Bambu Studio, AnycubicSlicerNext, QIDIStudio, ELEGOO/OrcaSlicer forks all emit the
  Orca-lineage `;TYPE:` vocabulary + `; printing object` (RR-007 §5.8) — a header may name one while the
  body is pure Orca.
- SuperSlicer forks PrusaSlicer; both emit `;TYPE:` + `EXCLUDE_OBJECT` + `; printing object`.
- Firmware flavour (Marlin / Klipper / RepRap / GRBL / LinuxCNC) is a **second, orthogonal** axis that
  already composes (DD-005 amendment 1) — the same file has a *slicer* family and a *controller* family.

Correct family attribution feeds real behaviour: DD-026 object/feature capture, colour conventions,
bed/geometry parsing, and honest provenance in the UI. A wrong single winner silently mis-parses; the
current tie→**none** rule is honest but discards a usable ranked answer.

## 2. Candidates / prior art tested (current behaviour)

The shipped model (`gcode-dialects/src/registry.ts`, `createDialectRunner`):
- Each adapter `detect(input): DialectDetection | null` returns **one** decision with a `confidence`
  (`known`/`inferred`/…) + `evidence` string (`contracts.ts:73`).
- The runner keeps the **highest-confidence adapter per `kind`** (`slicer` | `firmware` | `generic`);
  **ties select none** for that kind ("never a guess presented as a decision", registry.ts).
- CNC (#258) is the one place with **evidence scoring**: `scoreEvidence` in `cnc.ts` accumulates process
  signals (laser = tool-on + `S` + no-Z-plunge; mill = M3 + neg-Z-plunge; linuxcnc = header/O-words).

**Observed limitations** (to quantify against the corpus in the epic, not fully measured here):
1. A derivative file (Anycubic header, Orca body) resolves to whichever adapter claims highest
   confidence — no signal that a second family fits nearly as well.
2. Genuine ambiguity (two Prusa-lineage adapters both `known`) → tie → **none**, so a *usable* ranked
   answer ("PrusaSlicer 0.7 / SuperSlicer 0.6") is thrown away.
3. `evidence` is a free string, not a structured score, so a consumer can't reason about *why* or *how
   close* the runner-up was.

## 3. Proposed model to evaluate (the epic's hypothesis — not built)

A **multi-candidate scorer** layered over the existing per-adapter `detect()`:
- Each adapter returns a **score** (0..1) from weighted evidence (header generator string, marker
  vocabulary present/absent, config-block keys, container metadata) rather than a single boolean-ish
  confidence.
- The runner produces a **ranked candidate list** per axis (slicer family, controller family) with each
  candidate's score + structured evidence, plus a derived **ambiguity** measure (score gap between #1 and
  #2). The chosen adapter(s) still drive annotation (one winner runs), but the *result* exposes the
  ranked set so a consumer can show "OrcaSlicer (likely) / AnycubicSlicerNext (possible)" and decide
  trust.
- **Lineage graph:** encode the derivative relationships (Orca←Bambu/Prusa; Super←Prusa; Anycubic←Orca)
  so a shared marker credits the *family*, and a distinguishing marker breaks the tie.
- Honesty preserved: low top-score or high ambiguity → `inferred`/`unavailable`, never a fabricated pick.

**Open public-API question (owner-level, for the epic's DD):** does `DialectDetection` gain an optional
`candidates: {dialectId, score, evidence}[]` + `ambiguity`, or does the ranked set stay internal and only
raise confidence fidelity? This is a new public contract → an owner decision at DD time, not here.

## 4. Fixture / corpus manifest (what the epic must gather)

The blocking input. A **provenance corpus**: real files with **known** origin (slicer name + version,
controller), spanning the derivative families above and the ambiguous cases. Sources: the owner's
private samples (kept in `ProjectSource/`, **never committed**) reduced to **MIT-clean synthetic
fixtures** that reproduce the distinguishing markers, plus community-contributed headers. Each corpus
entry: `{ file, trueSlicerFamily, trueControllerFamily, distinguishingMarkers[] }`. Target coverage: the
Orca lineage (Orca/Bambu/Anycubic/QIDI), the Prusa lineage (Prusa/Super), Cura, ideaMaker, Simplify3D,
+ the controller axis (Marlin/Klipper/RepRap/GRBL/LinuxCNC). **Out of scope (not G-code):** Heidenhain
`.h`, Siemens `.mpf`, proprietary DSP/galvo formats — different languages, a separate concern.

## 5. Measurements & observable results

Deferred to the epic. The measurement protocol: run the corpus through (a) today's single-winner runner
and (b) a prototype multi-candidate scorer; report per-family precision/recall, the **ambiguity-handling
delta** (cases where tie→none today but a ranked answer is correct), and any regression on unambiguous
files (must stay a clean single winner). No measurements are claimed in this scope-only record.

## 6. License / provenance concerns

The owner's real sample files are **private** (`ProjectSource/`, git-ignored) and must not enter the
public corpus. Detection heuristics are derived from **observed marker behaviour**, not copied spec text
(RR-004 §6). Community-donated files need explicit licensing before inclusion. Header generator strings
are provenance data, not creative content.

## 7. Limitations & unknowns

- Marker vocabularies are not exhaustive (RR-007 §7); a scorer must degrade honestly on unseen dialects.
- Version granularity (PrusaSlicer 2.7 vs 2.9) may be under-determined by markers alone — the epic should
  decide whether family-level attribution is sufficient (likely yes).
- The corpus is the long pole: without enough labelled real files, a multi-candidate model can't be
  validated, which is exactly why this stays scoped.

## 8. Recommendation & rejected alternatives

**Recommendation.** Keep this **scoped, not built.** Open a "provenance detection" epic only once (a) the
labelled provenance corpus reaches meaningful coverage of the derivative families, and (b) a concrete
consumer need appears (e.g. AnyBridge or the UI needs a ranked family + confidence, not just a single
decision). Until then, today's single-winner + tie→none model is honest and adequate for the unambiguous
majority, and DD-026's marker-driven capture does not depend on perfect family attribution.

**Rejected now:** (1) building the multi-candidate scorer speculatively — no corpus to validate it, risks
over-fitting to a few files (the exact "benchy-lucky" trap the project avoids); (2) exposing a
`candidates[]` public API before a consumer needs it — a contract we'd have to keep. Revisit when §4 and
§7's unknowns are resolved.
