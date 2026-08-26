# DD-025 — Multi-plate model structure (plate identity as first-class model API)

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (with Claude)
**Date:** 2026-08-26 · **Last revised:** 2026-08-26
**Owning Epic:** ModelRenderer (the DD-018 line) · **Milestone:** TBD
**Supersedes / Superseded by:** none
**Related:** [DD-018](DD-018-model-renderer.md) (`ModelScene` / `parse3mf` — the structure this extends), [DD-021](DD-021-interactive-model-viewer.md) (`createModelViewer`), [DD-022](DD-022-model-instancing-and-lod.md) (instanced objects live *inside* plates), the toolpath-side `metadata.plates` (`PlateSummary`, #306/#3 — the multi-plate **container** precedent this mirrors on the **model** side). Consumer/proof case: AnyBridge "View in 3D" — multi-plate source `.3mf` files (a normal real-world workload for the target user).

> **Design principle (maintainer):** multi-plate 3MFs are **normal** real-world files for this product, so
> **plate identity should be first-class model structure**. The reusable renderer/model API must preserve
> plate grouping and support both **per-plate** and **all-plates** presentation. **Do not bake AnyBridge UI
> concepts into the renderer** — AnyBridge builds the carousel / buttons / plate selector from the exposed
> structure.

> **Accepted 2026-08-26 (maintainer), with four refinements folded in before implementation:**
>
> 1. **Plate membership attaches to the build-item / placement / instance layer, NOT the reusable master
>    object** — the same DD-022 master may be instantiated on multiple plates, so `plateId` lives on the
>    placement/instance, and a master is plate-agnostic (D1/D2 revised).
> 2. **`capabilities.plates: 'known'` iff the source EXPLICITLY declares plate structure — including an
>    explicitly-declared single plate.** Only *undeclared / implicit* plate structure is `'unavailable'`
>    (D4 revised — an explicit single plate is `known`, not `unavailable`).
> 3. **All-plates spatial separation / build-plate surfaces are PRESENTATION-ONLY and must NOT mutate source
>    coordinates** (D3 revised — separation is a render transform, the `ModelScene` keeps authored coords).
> 4. **The renderer supports `plateId | 'all'`, but must NOT force `'all'` as the consumer's UX default; if
>    the source provides an active/default plate, preserve it** (D2 revised).
>
> Cleared to proceed through the §9 phases autonomously; AnyBridge consumption seam coordinated directly with
> the AnyBridge session; return to the maintainer only for a genuinely new public-API / security /
> product-policy decision beyond this DD.

---

## 1. Problem

The **toolpath** side already treats plates as first-class: a multi-plate container exposes
`metadata.plates = { list: PlateSummary[], parsed }` and parses one plate at a time
(`parseOptions.plate`). The **model** side does not: `parse3mf` flattens every `<build><item>` into one
`ModelScene`, and the renderer exposes only an **"N copies"** instance count (DD-022) — there is **no plate
concept**. A source `.3mf` authored as several plates (a common slicer arrangement — many parts laid out
across multiple build plates in one file) renders as one undifferentiated blob: the viewer cannot say "plate
2 of 4", cannot show a single plate, and cannot present an all-plates overview. Plate identity that the file
carries is discarded.

## 2. Scope

Make plate structure first-class in the reusable model API:

1. **Expose plate grouping** in `ModelScene` — group build-items / objects (and their DD-022 instances) by
   the plate the source assigns them to, where the source declares plate structure.
2. **Per-plate presentation** — render/frame a single selected plate (analogous to the toolpath
   `parseOptions.plate`, but the model scene can hold all plates and select at render time rather than
   re-parsing).
3. **All-plates overview** — render every plate together with plate identity preserved (translucent,
   spatially separated plate surfaces so the plates read as distinct), for the "show me the whole file" view.
4. **Preserve plate identity through the pipeline** — thumbnail (`renderModelStill`), interactive
   (`createModelViewer`), and any variants keep the plate a first-class handle, not a re-derived guess.
5. **Reusable API only** — expose the structure; AnyBridge builds the selector UX. No carousel/button/UI
   concepts in the renderer.

**Out of scope:** the plate-selector UI (consumer-owned); toolpath container plates (already done); inventing
plates for a file that has none (a plate-less/single-plate source is honestly one plate).

## 3. Non-goals / honesty invariants

- **Plate structure is `known` only when the source declares it.** A source `.3mf` with no plate metadata is
  honestly a single implicit plate (`plates: 'unavailable'` / one-plate), never a fabricated split.
- Plate grouping derives from the **source's own** declaration (3MF build items + slicer plate metadata),
  never from geometric guessing (e.g. clustering by position) — that would invent structure.
- Instancing (DD-022) is preserved *within* a plate — a plate holds instanced masters, not baked copies.

## 4. Design decisions (proposed)

### D1 — `ModelScene.plates`, mirroring the toolpath `PlateSummary`

Add an optional `plates` grouping to `ModelScene`:

```
plates?: {
  list: ModelPlateSummary[];   // one entry per declared plate
  // objects/instances carry a plateId (or plates[i] references object indices) so the
  // renderer can select/return a single plate or all plates.
}
```

`ModelPlateSummary` proposed fields: `{ id, name?, objectCount, instanceCount, bounds }` — paralleling the
toolpath `PlateSummary` so consumers see a consistent plate shape across both renderers.

**Plate membership lives on the placement layer, not the master object (refinement 1).** The same DD-022
master mesh may be instantiated on more than one plate, so a plate cannot own a master. `plateId` attaches to
the **build-item / placement / instance** (each `instances[]` entry, or the build-item that produced it); the
master `ModelObject` stays plate-agnostic. A plate's membership is therefore the set of placements assigned to
it, which may reference masters shared with other plates. `ModelPlateSummary.instanceCount` counts placements
on that plate; `objectCount` counts the distinct masters it references (a master shared across plates counts
in each).

**Where the grouping comes from:** 3MF `<build><item>` entries plus the slicer's plate metadata (Bambu/Orca
plate definitions in `Metadata/…`); a build item is assigned to the plate the source declares. (The exact
metadata locations are a parse detail for the implementation; the honesty rule is fixed: **declared-only,
never guessed** — see D4.)

### D2 — Selection model: hold all, select at render

Unlike the toolpath container (which parses one plate at a time and re-parses to switch), the model scene is
already a single parsed structure — so `parse3mf` returns **all** plates in one `ModelScene`, and the
renderer **selects** at render time:

- `renderModelStill` / `createModelViewer` take a **plate selector** (`plateId | 'all'`) — render a single
  plate framed to it, or the all-plates overview. Switching plates in the interactive viewer is a cheap
  re-frame / visibility toggle, not a re-parse.
- **The renderer supports `plateId | 'all'` but must not force `'all'` as the consumer's UX default
  (refinement 4).** If the source declares an **active/default plate**, the scene preserves it and it is the
  natural initial selection; otherwise the initial selection is left to the consumer (the renderer does not
  impose all-plates). A sensible library default when the consumer passes nothing is the source's active
  plate if declared, else the first plate — **not** forced all-plates.
- The DD-022 fast-reject estimate and capability-aware budget (DD-023) apply to **what is rendered** — a
  single selected plate is cheaper than all-plates, so per-plate view can render where all-plates might hit
  the too-heavy signal (a natural, honest interaction with DD-023).

### D3 — All-plates presentation

The overview renders each plate's geometry with plate identity visible — translucent, spatially separated
plate surfaces (or per-plate framing offsets) so plates read as distinct groups rather than a merged blob.
**The separation is PRESENTATION-ONLY (refinement 3): it is a render-time transform applied to the rendered
copy, and must NOT mutate the source coordinates in the `ModelScene`.** The authored placement transforms are
preserved verbatim; the all-plates layout offset lives in the renderer, so a per-plate render (or any
consumer reading `ModelScene`) still sees the true authored coordinates. The *presentation* details
(separation distance, translucency) are renderer defaults; the *selector UX* is the consumer's.

### D4 — Capability tier + disclosure

`ModelScene.capabilities.plates: Confidence` — **`'known'` iff the source EXPLICITLY declares plate
structure, including an explicitly-declared single plate (refinement 2)**; `'unavailable'` only for
*undeclared / implicit* plate structure (a source with build items but no plate declaration → one implicit
plate, `'unavailable'`). So "one plate" is `known` when the source says so and `unavailable` when we merely
inferred it — the tier honestly distinguishes a declared single plate from an absence of plate information.
Mirrors the existing `multiObject` / `instanced` tiers (DD-022).

## 5. Public API surface (proposed — sign-off gate)

- **`ModelScene.plates`** + **`ModelPlateSummary`** exported type (D1), including the source's active/default
  plate id when declared.
- **`ModelScene.capabilities.plates: Confidence`** (D4).
- **Plate selector** `plateId | 'all'` on `renderModelStill` / `createModelViewer` (D2); library default is
  the active/declared plate else the first plate — **never forced all-plates**.
- A **`plateId` on the placement/instance layer** (refinement 1) — each build-item/instance carries its
  plate, since a shared master can appear on several plates; a consumer maps geometry to plates via
  placements, not via masters.
- Additive; an undeclared/implicit single-plate source behaves exactly as today (one implicit plate,
  `plates: 'unavailable'`, no `plates` grouping required).

## 6. Honesty & disclosure

- Plate count/identity is disclosed via `capabilities.plates`; a consumer shows a plate selector only when
  `plates: 'known'`.
- No plate is invented for a file that does not declare one; no geometric guessing.

## 7. AnyBridge consumer contract (coordinated; ratified separately AB-side)

AnyBridge reads `ModelScene.plates` and builds the selector (carousel / buttons / "All plates" toggle),
requests a plate (or all-plates) from `renderModelStill` / `createModelViewer`, and preserves the selected
plate through thumbnail ↔ View-in-3D ↔ variants. The renderer supplies plate structure + per-plate/all-plates
rendering; AnyBridge owns the selector UX. Ratified separately AB-side after this DD is Accepted.

## 8. Testing (proposed)

- A multi-plate source `.3mf` fixture (MIT-clean, synthetic — build items grouped across ≥ 2 plates): assert
  `plates.list` count, per-plate object/instance counts, and `capabilities.plates: 'known'`.
- An undeclared/implicit single-plate source: `capabilities.plates: 'unavailable'`, renders as one plate, no
  fabricated split. An **explicitly-declared** single plate: `capabilities.plates: 'known'`.
- A master shared across ≥ 2 plates: its placements carry distinct `plateId`s; per-plate selection renders
  only that plate's placements; the master is not duplicated.
- Per-plate render frames to that plate's bounds; all-plates render includes every plate with identity
  preserved **and the source coordinates unchanged** (separation is presentation-only — assert the scene's
  placement transforms are not mutated).
- Instancing preserved within a plate (a plate of reused masters instances, does not bake).

## 9. Open questions / implementation choices (resolved at acceptance)

The maintainer-accepted refinements settle the substantive questions; these are implementation choices made
during the phases (return only if one turns into a genuinely new public-API decision):

1. `ModelPlateSummary` aligns with the toolpath `PlateSummary` for consumer consistency (accepted direction).
2. Plate selector is `plateId | 'all'`; library default = the source's active/declared plate, else the first
   plate — **never forced all-plates** (refinement 4).
3. Bambu/Orca plate metadata first; a file with build items but no plate declaration = one **implicit** plate
   (`plates: 'unavailable'`); an explicitly-declared single plate = `'known'` (refinement 2).
4. All-plates presentation defaults (separation, translucency) — renderer default, consumer-tunable; strictly
   presentation-only, never mutating source coordinates (refinement 3).
5. Phasing: Phase A = parse + expose `plates` structure with placement-level `plateId` (no render change);
   Phase B = per-plate selection (default-plate aware); Phase C = all-plates overview presentation.
