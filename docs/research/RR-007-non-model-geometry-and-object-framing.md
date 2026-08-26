# RR-007 — Non-model geometry classification and `frameContent:'object'`

**Status:** Draft
**Author(s):** Nathaniel Chestnut
**Date:** 2026-08-26
**Owning work:** honest object framing for thumbnails/stills (`frameContent:'object'`) ·
**Informs:** an IR classification change (feature roles + non-model geometry) and the
`objectBounds`/framing computation in `@chestnutlabs/toolpath-core` + `@chestnutlabs/gcode-renderer-three`

## 1. Question & the decision it informs

`frameContent:'object'` is meant to frame the **printed model**, excluding slicer housekeeping
geometry (skirt, brim, prime line, purge/flush, wipe/prime tower). In practice a benchy thumbnail
frames the prime/purge line and shoves the model into a corner. The intended semantic is simple and
slicer-agnostic: **frame the model, not the housekeeping — whether or not object labels are present,
and without depending on a lucky `object != 0` convention.**

This record answers, grounded in what the supported slicers **actually emit**: (a) how each family
represents model vs. skirt/brim vs. prime/purge vs. wipe/prime-tower geometry; (b) what our pipeline
currently derives from those signals and where it fails; (c) the clean IR/classification change and
its fallback for files where classification genuinely cannot be known — so the fix is a real honesty
improvement, not a fixture-tuned heuristic.

## 2. What the slicers actually emit (real-file evidence)

Sampled from real files (read in place, never redistributed — MIT-clean synthetic fixtures will be
authored for the committed tests):

| File (slicer) | Feature comment vocab | Object labels | Housekeeping seen |
|---|---|---|---|
| `Fuse-Beads…` (**OrcaSlicer 2.4.2**) | **`;TYPE:`** — `Outer wall`, `Inner wall`, `Sparse infill`, `Top/Bottom surface`, `Internal solid infill`, `Internal Bridge`, `Gap infill`, `Custom` | `EXCLUDE_OBJECT_*` (Klipper) | `WIPE_START/END`, `flush`/`Flush`/`purge` |
| `CW3D-Sakura…` (**OrcaSlicer 2.4.2**) | `;TYPE:` — as above + `Brim`, `Bridge`, `Overhang wall` | `EXCLUDE_OBJECT_*` | `WIPE_START/END`, flush/purge |
| `4color-cube…prime-purge` (**AnycubicSlicerNext 1.3.8**) | `;TYPE:` — Orca-like vocab incl. **`;TYPE:Prime tower`**, `Custom` | `EXCLUDE_OBJECT_*` | `WIPE_START/END`, `FLUSH`/`flush`/`purge` |

Key observations:

1. **Modern OrcaSlicer and AnycubicSlicerNext emit `;TYPE:<Name>` — the same comment *prefix* Prusa
   and Cura use — NOT `; FEATURE:`.** The vocabulary is Orca/Bambu-flavoured (`Outer wall`,
   `Sparse infill`, `Prime tower`), distinct from Prusa's (`External perimeter`, `wipe tower`) and
   Cura's (`WALL-OUTER`, `SKIN`).
2. The **prime/wipe tower** carries a distinct marker: `;TYPE:Prime tower`.
3. The **standalone prime line / purge / flush** did *not* surface as a distinct `;TYPE:` in the
   sampled files — the `flush`/`purge` tokens appear as macro/config text, not toolpath feature
   markers. Whether a raw single-object benchy's prime line carries *any* feature marker is the open
   question for the primary fixture (§6, pending the review-env benchy header).
4. These Orca-family files also carry Klipper `EXCLUDE_OBJECT_*` object labels, so an object channel
   *is* available for them via the firmware adapter — but a raw PrusaSlicer/Cura single-object
   benchy typically carries **no** object labels at all.

## 3. Current pipeline behaviour and the gaps

Data model (from the annotation machinery, `@chestnutlabs/toolpath-core` + `@chestnutlabs/gcode-dialects`):

- **`FeatureRole`** (`toolpath-core/src/ir.ts:51-64`): `Unknown, Perimeter, ExternalPerimeter, Infill,
  SolidInfill, Support, Skirt, Brim, Bridge, Travel, Custom`. **No first-class `WipeTower/PrimeTower,
  Purge, Flush, Raft`** — those collapse to `Custom` or `Unknown`.
- **`MoveKind`** (`ir.ts:33-47`, bitflags): no `Purge/Prime/Flush` kind. `Wipe` is set only from
  `;WIPE_START/END` brackets.
- **`object` channel** (`ir.ts:121`): populated only by Orca/Bambu `; start/stop printing object`,
  Marlin `M486`, Klipper `EXCLUDE_OBJECT_*`. **PrusaSlicer and Cura set no object channel.**

Three compounding gaps:

- **G1 — `objectBounds` ignores feature roles.** `computeSegmentBounds` (`toolpath-core/src/bounds.ts:42-48`)
  and its post-annotation refresh (`gcode-dialects/src/sink.ts:174-194`) expand `objectBounds` from
  every `Extrude` segment with `object != 0` — they **never read `segments.feature`**, even when
  `featureRoles:'known'`. So `objectBounds` is object-channel-only.
- **G2 — feature roles are unreliable for real OrcaSlicer output.** Detection selects **one** slicer
  adapter per kind by header confidence (`gcode-dialects/src/registry.ts:9-11, 65-89`). An OrcaSlicer
  file selects the **orca-bambu** adapter on its header stamp — but that adapter's `onComment` matches
  **`FEATURE:`** (`orca-bambu.ts:102-105`), while the real files emit **`;TYPE:`**. Result: no feature
  ranges → `featureRoles` stays `unavailable`; the Prusa adapter that *does* parse `;TYPE:` is never
  selected. (AnycubicSlicerNext is worse: no adapter recognizes its header at all — a known
  object-label gap noted since v0.7.0.)
- **G3 — no prime-line/purge/flush classification anywhere.** No adapter, `MoveKind`, or `FeatureRole`
  distinguishes the prime line, purge, or flush; the prime/wipe *tower* is at best `FeatureRole.Custom`
  (Prusa/Orca/Cura maps), not separable from other `Custom` extrusion, and not excluded from bounds.

**Net effect on framing:**
- Labeled file (Orca/Bambu/M486/Klipper): `objectBounds` is populated, but any housekeeping extrusion
  emitted *inside* an object's contiguous label range is folded in; and towers/purge outside the
  object ranges are excluded only incidentally.
- Unlabeled file (raw PrusaSlicer/Cura benchy): `objectBounds` is empty → framing falls back to
  `ir.bounds` (all extrusion, incl. skirt + prime/purge) at `scene.ts:1125` and only discloses
  `E_FRAME_CONTENT_UNAVAILABLE`. `frameContent:'object'` excludes nothing.

## 4. Proposed direction (for the DD that follows)

The honest semantic — *frame the model, not housekeeping* — needs classification that does **not**
depend on the object channel. Proposed, in dependency order:

1. **Recognize the real signals.** Fix/extend the slicer adapters so feature roles are actually
   captured for the supported families: parse OrcaSlicer/AnycubicSlicerNext **`;TYPE:` with the
   Orca vocabulary** (not only `; FEATURE:`), and add first-class roles for the non-model categories
   that carry markers — **`PrimeTower`/`WipeTower`** (`;TYPE:Prime tower` / `wipe tower`), and
   `Skirt`/`Brim` (already mapped). This closes G2 and part of G3 for towers.
2. **Classify prime line / purge / flush.** Where a marker exists, map it to a `Purge`/`Prime` role;
   where it does not (a bare prime line before the first object), decide between a heuristic
   (short isolated pre-object extrusion far from the model centroid) and leaving it `Unknown` — a
   genuine honesty call (§5).
3. **Make framing consult feature roles.** `objectBounds` (or a new `modelBounds`) should be the bbox
   of extrusion that is **model content** — i.e. exclude `Skirt, Brim, PrimeTower/WipeTower, Purge`
   roles — *and* honor the object channel when present. This closes G1 and makes `frameContent:'object'`
   work for label-less Prusa/Cura files too, keyed on classification rather than `object != 0`.
4. **Honest fallback.** When neither object labels nor feature roles are known (classification
   genuinely unavailable), frame all extrusion and disclose (today's `E_FRAME_CONTENT_UNAVAILABLE`) —
   never silently pretend. A partial signal (roles known, objects not) should still exclude the
   role-identified housekeeping.

## 5. Decisions this raises for the maintainer

- **Honesty model:** is "model bounds = all extrusion minus role-identified housekeeping" the right
  definition, and what is the disclosure when only *some* housekeeping is classifiable (e.g. tower
  known, bare prime line not)? Partial exclusion is more correct but less predictable.
- **New public surface:** new `FeatureRole` values (`PrimeTower`/`WipeTower`/`Purge`) are additive but
  public; a possible new `modelBounds` on the IR (vs. redefining `objectBounds`) is an API/semantics
  choice. Redefining `objectBounds` to mean "model bounds" changes an existing contract.
- **Heuristic boundary:** whether to detect an unlabeled bare prime line heuristically at all, or hold
  the line at "only classify what the slicer marks." The maintainer explicitly does **not** want a
  benchy-lucky heuristic; §4.2's heuristic is therefore proposed as *opt-in / disclosed*, not default.

These are flagged for the owner; the RR does not decide them.

## 5b. Empirical validation (2026-08-26) — real files through the current pipeline

Parsed real files (in place) through the default adapter set at HEAD (0.14.0-equiv). Results confirm
the gaps and, importantly, **partition the bug**:

| File (slicer) | detected slicer | featureRoles | objects | `objectBounds` vs all-bounds |
|---|---|---|---|---|
| `4color…prime-purge` (**AnycubicSlicerNext**, has `EXCLUDE_OBJECT`) | prusaslicer (*mis*detected) | **known** | **known** (via Klipper `EXCLUDE_OBJECT`) | objectBounds `y[103..157]` **excludes** the prime line (all-bounds `y[103..262.5]`) |
| `Fuse-Beads…` (**OrcaSlicer 2.4.2**, no `EXCLUDE_OBJECT`) | orca-bambu | **unavailable** | **unavailable** | objectBounds **empty** → framing falls back to all extrusion |
| `CW3D-Sakura…` (**OrcaSlicer 2.4.2**, no `EXCLUDE_OBJECT`) | orca-bambu | **unavailable** | **unavailable** | objectBounds **empty** → falls back |

Findings:

- **The primary bad-framing case IS handled at 0.14.0+ when the file carries `EXCLUDE_OBJECT`.** The
  prime line is `;TYPE:Custom` emitted *outside* the object block (bed-edge Y≈262 while the object is
  Y≈119–140); the object channel (populated from Klipper `EXCLUDE_OBJECT`) plus the post-annotation
  `objectBounds` refresh (landed **v0.7.0**) makes `objectBounds` exclude it. AnyBridge's benchy and
  Dune Striker both carry `EXCLUDE_OBJECT`, so **they are fixed by a version bump** past v0.7.0 (they
  were framing badly on a stale deployed sidecar). This is a proxy-confirmed result (the 4-cube file is
  the same slicer + same "prime line outside object blocks" structure).
- **Two confirmed adapter-format bugs** break real OrcaSlicer files that DON'T carry `EXCLUDE_OBJECT`:
  1. **Object marker:** `orca-bambu.ts:107` matches `start printing object, id:<\d+>` — but OrcaSlicer
     emits `; printing object <name> id:<id>` (no "start"; `<id>` is a large integer or a small index
     with `copy N`). → object channel not populated ⇒ `objects:'unavailable'`.
  2. **Feature marker:** `orca-bambu.ts:102` matches `; FEATURE:` — but OrcaSlicer emits `;TYPE:<vocab>`.
     → `featureRoles:'unavailable'`.
  With neither object labels nor feature roles, `objectBounds` is empty and `frameContent:'object'`
  frames all extrusion (prime line included) — and a version bump does **not** fix these.

So the fix has two tiers: **(T1)** correct the orca-bambu adapter to parse OrcaSlicer's real
`; printing object` + `;TYPE:` formats (restores object + feature capture for real Orca output, no new
public surface — a bug fix); **(T2)** the feature-role-based *model bounds* of §4 for genuinely
label-less files (Prusa/Cura) — the honesty-model/API change.

## 6. Validation plan / open items

- **DONE — primary fixture identified** (AnyBridge review env): `benchy_PLA_0.2_43m10s.gcode` is
  **AnycubicSlicerNext 1.3.8** with `EXCLUDE_OBJECT` + `; exclude_object: 1`; its prime line is
  `;TYPE:Custom` at Y≈262 (outside the print area) while the boat sits Y≈119–140 — the off-to-the-side
  prime line doubles the Y-extent. Dune Striker is OrcaSlicer 2.4.2, same structure (`;TYPE:Custom`
  before `; printing object`). Both carry `EXCLUDE_OBJECT` (§5b).
- **DONE — empirical parse** (§5b): confirmed `featureRoles`/`objects` `unavailable` for real OrcaSlicer
  output, `known` (and prime-line-excluding `objectBounds`) for the `EXCLUDE_OBJECT` case.
- **Cross-family variance (in progress):** a dedicated slicer-research session is gathering PrusaSlicer
  (`M486` + `;TYPE:`) and Cura (`;TYPE:SKIRT`, no object channel) marker formats — the label-less
  cases §4's model-bounds must serve. (OrcaSlicer + AnycubicSlicerNext already covered here.)
- **Fixtures:** author MIT-clean synthetic fixtures for the missing cases — a skirt/brim + prime-line +
  purge Prusa/Cura file with no object channel, and an Orca `;TYPE:`-vocab file with a prime tower — so
  the eventual fix has committed coverage (none exists today; the current object-exclusion path is only
  proven via the object channel).
