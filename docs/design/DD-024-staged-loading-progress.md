# DD-024 — Staged loading progress (real stages and counts, never faked)

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (with Claude)
**Date:** 2026-08-26 · **Last revised:** 2026-08-26
**Owning Epic:** ToolpathRenderer / ModelRenderer (cross-cutting) · **Milestone:** TBD
**Supersedes / Superseded by:** none
**Related:** [DD-006](DD-006-normalized-live-progress-and-source-position-mapping.md) (normalized *print* progress — the honesty patterns this reuses for *loading* progress; the two are different phases), [DD-018](DD-018-model-renderer.md) / [DD-021](DD-021-interactive-model-viewer.md) (model parse/build), [DD-022](DD-022-model-instancing-and-lod.md) (instanced model build — the "processing X of Y" counts come from its resolve step), [DD-023](DD-023-capability-aware-render-budget.md) (the GPU-upload/build stage this progresses through). Consumer/proof case: AnyBridge "View in 3D" / thumbnails — large files "feel hung."

> **Design principle (maintainer):** progress must be **real** — driven by actual stages and counts the
> pipeline genuinely knows — **never a faked percentage or a fabricated smooth bar**. A large file that takes
> time should *show what it is doing* (which stage, how far through a real count), not a made-up animation.
> Design this as **reusable renderer API**, not AnyBridge-specific loading UI.

> **Accepted 2026-08-26 (maintainer), with three refinements folded in before implementation:**
>
> 1. **Structured and consumer-neutral — the renderer emits NO human-facing UI copy.** Events carry typed
>    `stage` / `done` / `total` / `unit` data only; the consumer owns all wording and i18n. The optional
>    free-text `detail` field is removed (D2 revised).
> 2. **Progress is scoped to a load/generation.** Each `setSource` / parse gets a generation token; a
>    stale event from a cancelled or superseded load can **never** update the next load's progress
>    (last-wins, mirroring the existing model-viewer token — new D5).
> 3. **`preparing-scene` claims only what is observable.** If meshes/chunks were *submitted* to the GPU,
>    say *submitted* — do **not** report "completed GPU upload" unless completion is genuinely measurable
>    (D1/D2 revised; honest-count invariant sharpened).
>
> Cleared to proceed through the §9 phases autonomously; AnyBridge consumption seam coordinated directly with
> the AnyBridge session; return to the maintainer only for a genuinely new public-API / security /
> product-policy decision beyond this DD.

---

## 1. Problem

Today the only loading signal is **byte-based parse progress** (`parse-progress`, bytes read / total) from
the parser worker. For a large file the perceived timeline is: a byte bar creeps to 100 % (parsing), then a
**silent gap** while the IR is turned into geometry, chunks are built, and the GPU scene is uploaded — the
model renderer has no progress at all. The user sees "Loading…" with nothing moving and reasonably concludes
it hung (this is the same felt-hang family as the [DD-023](DD-023-capability-aware-render-budget.md) 96 s
raster, but here even a *fast* render looks stalled because the non-parse stages are invisible).

The pipeline **knows** real quantities at each stage — bytes, layers, segments (toolpath); components,
objects, instance placements, triangles (model) — but does not surface them as progress. A faked smooth
percentage would be dishonest (and the project's honesty model forbids inventing data); the fix is to expose
the **real** stages and counts that already exist.

## 2. Scope

A reusable, capability-honest **loading-progress event stream** across both pipelines and both entry points:

1. **Typed stages** covering the whole load, not just parsing — parse → structure → material → per-object →
   per-segment/geometry → GPU upload → ready.
2. **Real counts** on each stage where the pipeline genuinely knows them (X of Y), and an **honest
   indeterminate** state where it does not — never a fabricated total or interpolated percentage.
3. **Both paths:** toolpath (`GcodeParseSession` → `ToolpathRenderer`) and model (`resolveModelScene` →
   `ModelRenderer` / `createModelViewer` / `renderModelStill`).
4. **Reusable API only** — a progress event/callback surface; the consumer builds the UI. No AnyBridge
   loading-UI concepts in the renderer.

**Out of scope:** the *visual* loading UI (consumer-owned); print-time progress (that is DD-006, a different
phase); changing parse/IR output.

## 3. Non-goals / honesty invariants

- **Never fake a percentage.** A stage reports a real `{done, total}` only when both are genuinely known; a
  stage whose total is unknowable reports `indeterminate: true` (the consumer shows a spinner / "reading…",
  not a fake bar). No interpolation across stages into a single invented 0–100 %.
- Progress is **advisory** — it never changes what is parsed or rendered, and adds no measurable overhead
  (counts are already computed; this only emits them).
- Cancellable/abortable exactly as today (`GcodeParseSession` cancel); progress events stop on cancel.

## 4. Design decisions (proposed)

### D1 — A typed stage enumeration

A stable, public `LoadStage` union covering the observable pipeline. Proposed stages (names for sign-off):

| Stage | Emitted by | Real count available? |
| --- | --- | --- |
| `parsing` | parser worker | bytes read / total (existing `parse-progress`) |
| `reading-structure` | parse3mf / container | components / objects / plates discovered (3MF); layers (gcode) |
| `decoding-material` | parse3mf / metadata | filaments / materials decoded (when present) |
| `processing-objects` | model resolve (DD-022) | X of Y objects / components / instance placements |
| `building-geometry` | chunk builder / mesh build | X of Y segments (toolpath) / X of Y objects (model) |
| `preparing-scene` | renderer (GPU submit) | X of Y chunks / meshes **submitted** (see D2 — "submitted", not "uploaded/completed", unless completion is measurable) |
| `ready` | renderer | — (terminal) |

Not every source hits every stage (a bare STL has no material/plate stage; a `.gcode` has no
component/instance stage). A stage is emitted **only** when the pipeline actually performs it — the sequence
is honest to the file, not a fixed template.

### D2 — Event shape: typed, consumer-neutral, real counts or honest indeterminate

A progress event carries **typed, machine-readable fields only** — `{ stage, done?, total?, unit?,
indeterminate?, generation }` — and **no human-facing UI copy** (refinement 1). The renderer never emits a
display string; the consumer formats all wording/i18n from the typed fields.

- `{stage, done, total, unit}` when a real count exists — e.g. `{processing-objects, 40, 814,
  'placements'}`; `{building-geometry, 1_200_000, 1_730_038, 'segments'}`. `unit` is a typed enum
  (`'bytes' | 'segments' | 'objects' | 'components' | 'placements' | 'meshes' | 'chunks'`), not a label.
- `{stage, indeterminate: true}` when the stage is real but has no meaningful total yet (e.g. decompressing a
  stream of unknown size) — the consumer shows an activity indicator, not a bar. Never a fabricated total.
- **`preparing-scene` reports only what is observable (refinement 3):** the count is chunks/meshes
  **submitted** to the GPU (a real, countable quantity), carried as `unit: 'meshes' | 'chunks'`. It does
  **not** claim "GPU upload completed" — WebGL gives no cheap completion signal, so completion is not
  reported as a count; the stage advances to `ready` when the render loop has the scene, which is the honest
  terminal, not a fabricated 100 %-uploaded.
- Every event carries the `generation` token (D5) so a consumer can drop a stale one.

Emission is **throttled** (coalesce to a sane cadence — e.g. ≤ N/sec or on stage change) so a multi-million
count does not flood the event loop; the throttle is a renderer concern, transparent to the consumer.

### D3 — One stream across both paths and both entry points

The same `onProgress` surface on:

- **Toolpath:** `GcodeParseSession` already emits parse bytes; extend the session/renderer so the
  post-parse stages (`building-geometry`, `preparing-scene`) also emit. `renderStill` emits the same stages
  headlessly.
- **Model:** `resolveModelScene` + `ModelRenderer` emit `reading-structure` / `decoding-material` /
  `processing-objects` / `building-geometry` / `preparing-scene`. `createModelViewer` and `renderModelStill`
  share it (the shared model core).

### D4 — Composition with capability-aware (DD-023) and instancing (DD-022)

- The `processing-objects` counts come directly from the DD-022 instanced resolve (unique masters +
  placement count), so the count is the *real* structural work, not baked copies.
- When [DD-023](DD-023-capability-aware-render-budget.md) fires the **too-heavy** signal (a fast pre-check
  reject), progress ends at that decision with the too-heavy event — it does **not** show a build bar for a
  render that will not be attempted. Loading progress and the too-heavy signal are complementary: progress
  says "working, here's how far"; too-heavy says "not attempting this, here's why + the lighter path."

### D5 — Progress is scoped to a load/generation (no stale cross-load leakage)

Each `setSource` / parse starts a new **generation** (a monotonic token, reusing the model-viewer's existing
last-wins token and adding the equivalent to the toolpath session). Every progress event carries its
`generation`. A load that is **cancelled or superseded** by a newer `setSource` stops mattering: its
in-flight events either are not emitted (the emitter checks the current generation before firing) or are
tagged with the stale generation so a consumer drops them. **A stale event can never advance the next load's
progress** — the classic "old file's 80 % bar jumps into the new file's load" bug is structurally
prevented. On cancel, the stage stream ends (no `ready`); on supersede, the new generation's stream begins
cleanly.

## 5. Public API surface (proposed — sign-off gate)

- **`onProgress(cb: (e: LoadProgress) => void)`** (or an event on the existing emitter) on the toolpath
  session/renderer and the model viewer/still + `renderStill`/`renderModelStill`.
- **`LoadStage`** union and **`LoadProgress`** type (`{stage, done?, total?, unit?, indeterminate?,
  generation}`) — exported public types. **No human-facing string field** (refinement 1); `unit` is a typed
  enum, not a label.
- Additive; existing `parse-progress` remains (or is subsumed as the `parsing` stage — a compatibility
  question for sign-off).

## 6. Honesty & disclosure

- Counts are real or absent — the type makes a fake percentage unrepresentable (no single 0–100 field to
  fabricate; a consumer that wants an overall bar must derive it from real per-stage counts and label it
  honestly).
- **No human-facing copy from the renderer** (refinement 1): the event is typed data only, so the renderer
  never ships wording that could drift from the truth or a locale.
- **`preparing-scene` reports submitted, not completed** (refinement 3): the count is real GPU *submissions*;
  the DD does not claim measured upload completion where WebGL offers none.
- A stage is emitted only when the work happens, so the stage sequence itself is an honest description of what
  the file required.

## 7. AnyBridge consumer contract (coordinated; ratified separately AB-side)

AnyBridge renders the loading UI from the **typed** stream: a real bar where `{done,total,unit}` exist, a
spinner where `indeterminate`. It maps typed stages to its **own** copy ("Reading plate structure",
"Processing object 3 of 12", "Building geometry", "Preparing preview") and owns all wording, layout, and
i18n — the renderer supplies no strings. It uses the `generation` token to ignore stale events from a
superseded load. Ratified separately on the AnyBridge side after this DD is Accepted.

## 8. Testing (proposed)

- Stage-sequence tests per source kind (STL: no material/plate stage; multicolor 3MF: all stages; large
  `.gcode`: parse → building-geometry with real segment counts) — assert the emitted sequence matches the
  work actually done.
- Count-honesty tests: every emitted `{done,total}` corresponds to a real quantity; no event fabricates a
  total; indeterminate stages never carry a `total`; **no event carries a human-copy string** (typed fields
  only).
- **Generation-scope test (refinement 2):** start load A, supersede with load B mid-stream; assert no
  A-generation event updates B, and a late A event is either not emitted or tagged stale.
- **`preparing-scene` honesty test (refinement 3):** the stage reports submitted counts, never a
  completed-upload total the renderer cannot measure.
- Throttle test: a multi-million-count build emits a bounded number of events.
- Cancel test: progress stops promptly on cancel (no `ready`, no further events for that generation).

## 9. Open questions / implementation choices (resolved at acceptance)

Substantive semantics are settled by the accepted refinements; these are implementation choices for the
phases (return only if one becomes a genuinely new public-API decision):

1. Whether `parse-progress` stays as-is or is folded into the `parsing` stage (compatibility) — decide during
   Phase B (toolpath), keeping backward compatibility.
2. One shared exported `LoadProgress` type across both paths (accepted direction).
3. `preparing-scene` granularity: count chunks/meshes **submitted** where observable, else a single
   indeterminate step — never a fabricated upload-completed total (refinement 3).
4. Throttle cadence default (implementation tuning).
5. Phasing: Phase A = model path stages (the current total gap — the model renderer has no progress at all),
   with the `generation` scoping; Phase B = toolpath post-parse stages; both reuse one type.
