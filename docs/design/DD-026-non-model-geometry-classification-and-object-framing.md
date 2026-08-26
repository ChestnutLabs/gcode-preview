# DD-026 — Non-model geometry classification and object framing

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (drafted by Claude)
**Date:** 2026-08-26 · **Last revised:** 2026-08-26
**Accepted:** 2026-08-26 — D1–D7 as recommended (D3a = `MoveKind.Purge` bitflag; D5 = new additive
`modelBounds`, `objectBounds` contract unchanged; D6 = start-region heuristic opt-in + disclosed,
never default). Phase 1 (T1 adapter-format corrections) authorized to build.
**Owning Epic:** E9/E11 (renderer options + honesty model) · **Milestone:** —
**Supersedes / Superseded by:** none
**Related:** [RR-007](../research/RR-007-non-model-geometry-and-object-framing.md), DD-005 (dialect
adapters), DD-016 (annotation-derived move kinds), issue #306 (`frameContent`)

---

## 1. Problem

`frameContent:'object'` must frame the **printed model** and exclude slicer housekeeping (prime line,
skirt, brim, purge/flush, wipe/prime tower). Today it frames the bbox of the per-segment **object**
channel (`objectBounds`, `toolpath-core/src/bounds.ts:42`), which fails in two ways proven in RR-007:

1. **Adapter formats are stale for real output.** The `orca-bambu` adapter matches `; FEATURE:` and
   `; start printing object` — but real OrcaSlicer emits `;TYPE:` and `; printing object <name>
   id:<id>` (no "start"). So real Orca files without a Klipper `EXCLUDE_OBJECT` channel get **no**
   objects and **no** feature roles → `objectBounds` empty → framing falls back to all extrusion
   (prime line included).
2. **`objectBounds` ignores feature roles.** Even when skirt/brim/tower roles are known, bounds never
   consult `segments.feature`, and slicers that emit **no** object channel at all (Cura, Simplify3D,
   unlabeled PrusaSlicer) get no exclusion.

RR-007 established, across PrusaSlicer, Cura, SuperSlicer, Bambu, Simplify3D, ideaMaker, and
Orca/Anycubic, that the reliable signals are **object membership + explicit housekeeping brackets +
feature roles**, in a precedence order — not the `object != 0` convention alone, and never the
`;TYPE:Custom` a prime line carries.

## 2. Scope

- **T1 — adapter-format corrections** so the real markers in RR-007 §5 are actually captured
  (`@chestnutlabs/gcode-dialects`).
- **T2 — a precedence-ordered non-model classifier** and a **model bounds** it produces
  (`@chestnutlabs/toolpath-core`), consumed by `frameContent:'object'`
  (`@chestnutlabs/gcode-renderer-three`), with honest disclosure when classification is unavailable.

## 3. Non-goals

- No change to rendered geometry, colours, or the `quality`/`qualityMode`/`progressivePreview` axes.
- No slicer-specific *coordinate* heuristics (e.g. "bed edge = prime"); classification is marker-driven.
- Not a general feature-role coverage push — only the roles that framing needs to exclude.
- The start-region heuristic for genuinely unmarked prime geometry is **opt-in** (D6), not a default.

## 4. Data contracts / API

### D1 — Adapter format corrections (T1). **Recommendation: adopt.**
Update adapters to the RR-007 §5 markers. Bug fix; no new public surface:
- **orca-bambu:** accept feature comments as **both** `;TYPE:<vocab>` and `; FEATURE:<vocab>`; accept
  object markers as `; printing object <name> id:<id>` / `; stop printing object …` (drop the
  `start` requirement; tolerate large ids and `copy N`); keep Bambu `; start printing object, unique
  label id:<n>` + `M624`/`M625`.
- **firmware (klipper/marlin):** already handle `EXCLUDE_OBJECT_*` / `M486`; add **ideaMaker**
  `;PRINTING: <name>` + `;PRINTING_ID: <n|-1>` state (a new small slicer adapter or an ideaMaker
  detection path) as an object-membership channel.
- **cura:** `;MESH:<name>` / `;MESH:NONMESH` recognized as a **mesh hint, not membership** (never sets
  the object channel); keep `;TYPE:<UPPER>` roles.
- **simplify3d:** parse `; feature <lowercase>` roles (a new adapter); no object channel.
- **superslicer:** already Prusa-lineage `;TYPE:` + `EXCLUDE_OBJECT` + `; object:{…}` footprint.

### D2 — New `FeatureRole` values. **Recommendation: add `PrimeTower`, `WipeTower`, `Raft`.**
`FeatureRole` (`toolpath-core/src/ir.ts:51`) currently folds towers into `Custom`. Add first-class
`PrimeTower`, `WipeTower`, `Raft` (additive numeric-index values → **minor**). Map per family:
PrusaSlicer/Super `Wipe tower`; Orca/Bambu `Prime tower`/`FEATURE: Prime tower`; Cura `PRIME-TOWER`;
ideaMaker `WIPE-TOWER`; Simplify3D `prime pillar`; Cura/ideaMaker/Prusa raft/`RAFT`.

### D3 — Purge/flush + tower brackets. **Recommendation: reuse the DD-016 bracket mechanism.**
`WIPE_START/END` already becomes `MoveKind.Wipe` additively (`annotate.ts`). Extend the same
range-bracket path for the explicit housekeeping brackets RR-007 found — Bambu `WIPE_TOWER_START/END`
and `FLUSH_START/END` — mapping the enclosed range to the tower role (D2) and, for flush, a new
`MoveKind.Purge` (a bitflag alongside `Wipe`) OR a `FeatureRole` — **decision below (D3a)**.

- **D3a — purge/flush as MoveKind vs FeatureRole. Recommendation: `MoveKind.Purge` (bitflag).** Flush
  is a *motion class* (like Wipe), not a print feature; a bitflag composes with `Extrude` and mirrors
  `Wipe`. Additive; FDM byte-identical (a new capability key only). *Open for maintainer: acceptable
  to add an 8th→9th MoveKind bit?*

### D4 — The precedence classifier (RR-007 §8), in `toolpath-core`.
A pure function over the IR that labels each extrusion segment **model** or **housekeeping** by the
first matching rule:
1. explicit housekeeping bracket/role (tower roles D2, `MoveKind.Purge` D3, `Wipe`);
2. explicit non-object state (`M486 S-1`, ideaMaker `PRINTING_ID:-1`, outside `EXCLUDE_OBJECT`/`M624`);
3. explicit active-object membership (`object != 0`);
4. feature fallback (exclude `Skirt`, `Brim`, `Raft`, `Support`, tower roles);
5. (opt-in, D6) start-region fallback.

### D5 — Framing consumes a new `modelBounds`. **Recommendation: add `modelBounds`, don't redefine `objectBounds`.**
Add `ir.modelBounds` (bbox of D4-classified **model** segments; empty when unknowable). `objectBounds`
keeps its current contract (object-channel bbox). `pickFramingBounds` (`scene.ts:1118`) precedence
becomes **`modelBounds` → `objectBounds` → `bounds`**, each gated on finiteness. This is additive and
preserves the existing `objectBounds` meaning for any current consumer.

### D6 — Fallback + honest disclosure.
When D4 yields no model classification (no object channel, no exclusive feature roles, e.g. Simplify3D
single object with an unmarked prime line), framing falls back to `bounds` and discloses today's
`E_FRAME_CONTENT_UNAVAILABLE`. The **start-region heuristic** (rule 5) is exposed as an explicit opt-in
(`frameContent:'object-heuristic'` or a `renderStill` flag) and, when it acts, discloses that the
exclusion was inferred — never a silent default. *(The maintainer explicitly rejected a default
benchy-lucky heuristic.)*

### D7 — Capability disclosure. **Recommendation: a `nonModelClassification` capability.**
Advertise `known` (explicit membership/brackets drove the classification), `inferred` (feature-role or
heuristic only), or `unavailable` — so a consumer can decide whether to trust `frameContent:'object'`
or show all extrusion. Consistent with the project honesty model.

## 5. Lifecycle

Classification is derived once, post-parse, in the dialect-annotation finalize step (where the object
and feature channels already settle, `sink.ts`), producing `modelBounds` alongside the existing
`objectBounds` refresh. No runtime mutation; recomputed only on re-parse. The renderer reads it from
the IR exactly as it reads `objectBounds` today.

## 6. Errors & failure behavior

No new failure mode. Missing signals degrade honestly (D6): fall back to all-extrusion framing +
disclosure, never a wrong-but-silent frame. Malformed markers are ignored (adapters already contain
per-adapter exceptions, DD-005).

## 7. Security & resource limits

None new. Classification is a single O(segments) pass over already-parsed SoA channels; no new parsing
of untrusted structure, no allocation beyond one bounds accumulation. Adapters remain comment/command
observers (no lexing/dispatch influence).

## 8. Performance

One extra O(n) pass over the segment kind/feature/object channels during finalize (same shape as the
existing `computeSegmentBounds`), plus at most one new `MoveKind`/`FeatureRole`-width consideration —
negligible next to parse. No render-time cost (framing reads a precomputed bbox). Measure against the
existing dialect-annotation benchmark; budget: no measurable regression on the RR-006 Dragon plate.

## 9. Testing

- **Unit (adapters):** per-family fixtures from RR-007 §9 — real markers reduced to MIT-clean synthetic
  files: Prusa labeled/unlabeled + Custom prime + skirt/brim; Orca `;TYPE:` + `; printing object`
  (no EXCLUDE_OBJECT); Cura `MESH` + skirt + prime tower while a mesh stays active; Klipper
  `EXCLUDE_OBJECT` with housekeeping outside membership; Bambu unique-label + `WIPE_TOWER`/`FLUSH`
  overlapping a still-open object; ideaMaker `PRINTING_ID` n/-1; Simplify3D lowercase features.
- **Classifier (toolpath-core):** `modelBounds` excludes prime line / tower / skirt / flush; equals
  `objectBounds` when only an object channel exists; empty → framing falls back + discloses.
- **Renderer:** `frameContent:'object'` frames `modelBounds` when present; the RR-007 benchy proxy
  (prime line outside object block) frames the model.
- **Invariance:** all new capability keys are additive → FDM geometry byte-identical; regen native
  goldens with `UPDATE_GOLDEN=1` (kind/feature channel widening only).

## 10. Migration

Additive. Existing consumers reading `objectBounds` are unaffected (contract unchanged). New
`FeatureRole`/`MoveKind`/`modelBounds`/capability are opt-in reads. A **minor** lockstep bump. No
inherited xyz-tools structure changes. `frameContent:'object'` improves silently for labeled files and
newly works for label-less ones; the only behavior change is *better* exclusion, disclosed.

## 11. Observability / diagnostics

The `nonModelClassification` capability (D7) is the primary diagnostic. Framing continues to emit
`E_FRAME_CONTENT_UNAVAILABLE` when it cannot classify. No local paths / filenames in any surface
(privacy-preserving).

## 12. Alternatives considered

- **Redefine `objectBounds` to mean model bounds** — rejected: breaks the current object-channel
  contract for any consumer reading it; `modelBounds` is additive and honest (D5).
- **Feature-role exclusion only (no membership precedence)** — rejected: prime lines are `;TYPE:Custom`
  (RR-007), so role exclusion alone misses them; and Bambu emits towers *inside* an open object bracket,
  so membership can't override explicit tower markers (RR-007 §8 rule 1).
- **Cura `;MESH:` as membership** — rejected: a model mesh name stays active immediately before a
  `PRIME-TOWER` (RR-007 §5.2).
- **Default start-region heuristic** — rejected by the maintainer: a coordinate/ordering heuristic that
  "happens to work for the benchy" is exactly what this must avoid; kept opt-in + disclosed (D6).
- **Infer feature syntax from the generator name** — rejected: Orca lineage emits both `;TYPE:` and
  `; FEATURE:` by profile; accept the markers actually present (D1).

## 13. Risks

- **Adapter regressions (T1).** Broadening the orca-bambu patterns could mis-capture; mitigated by the
  per-family fixtures (D9) and the geometry-invariance gate.
- **Marker variance beyond the corpus.** RR-007 §7 notes vocabularies aren't exhaustive; unmapped
  housekeeping tokens fall to `Custom` (kept in-frame) rather than being wrongly excluded — the safe
  direction. Disclosure (D7) signals lower confidence.
- **MoveKind bit budget (D3a).** Adding `Purge` consumes another bit; if the maintainer prefers, flush
  can be a `FeatureRole` instead (no bit) at the cost of composing less cleanly with `Extrude`.

## 14. Phased delivery

- **Phase 1 (T1, ships first — immediate correctness):** adapter-format fixes (D1) + fixtures. Restores
  objects/feature roles for real Orca output; label-bearing files frame correctly. No new public API.
- **Phase 2 (T2 core):** `FeatureRole` additions (D2), flush/tower brackets + `MoveKind.Purge` (D3),
  the classifier + `modelBounds` (D4) in toolpath-core, capability (D7).
- **Phase 3 (T2 framing):** `pickFramingBounds` consumes `modelBounds` (D5) + disclosure (D6); adapters
  wire the new roles/brackets per family.
- **Phase 4 (optional):** opt-in start-region heuristic (D6), only if the maintainer approves.

## 15. Acceptance criteria

1. Real OrcaSlicer output **without** `EXCLUDE_OBJECT` yields `objects:'known'` and `featureRoles:'known'`
   (T1 fixtures).
2. `frameContent:'object'` frames the model (excludes the prime line) for: a Klipper/Orca
   `EXCLUDE_OBJECT` file, a PrusaSlicer labeled file, and a **label-less** Cura file with a prime
   tower — via `modelBounds`, disclosed by `nonModelClassification`.
3. A genuinely unclassifiable file (Simplify3D, unmarked prime) frames all extrusion **and** discloses
   `E_FRAME_CONTENT_UNAVAILABLE` — no silent wrong frame.
4. FDM geometry byte-identical across all changes (goldens regenerated for additive capability keys
   only). No core package depends on AnyBridge.
