# DD-029 — Preparation lifecycle & single clean reveal

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (drafted by Claude)
**Date:** 2026-08-26 · **Last revised:** 2026-08-26
**Accepted:** 2026-08-26 — with one refinement: `progressivePreview` becomes
`'auto' | 'lines' | 'hold' | 'off'`, `'auto'` the eventual default (D1). In `'auto'`, cheap scenes may
progressively render lines and sufficiently expensive scenes automatically take the single-reveal
`'hold'` path, decided on **actual/predicted render cost + capability, not file byte size**; explicit
consumer selection always overrides. `buildComplete` stays reveal-authoritative, `ready` never precedes
it, failures terminate through the normal error path. **No preview mode drops extrusion segments or
lowers final geometry quality** — `lines` vs `hold` is only how often incomplete work is drawn; the
final render policy is separate. AnyBridge explicitly requests `'hold'` for the product experience.
**Owning Epic:** E9/E11 (renderer UX + honesty) · **Milestone:** —
**Supersedes / Superseded by:** none
**Related:** [RR-008 §8.1](../research/RR-008-parallel-geometry-construction.md) (the render-during-build
finding), DD-028 (worker pool — makes preparation *faster*; this DD makes it *first-class*), DD-027
(RenderStats), the `progressivePreview` option (v0.15.0), `renderStill` `renderDuringBuild` (#375),
`gcode-model-renderer` (model stills for the placeholder)

---

## 1. Problem

Today the interactive renderer re-renders the **growing, half-built** toolpath every build tick
(`renderDuringBuild=true`) — RR-008 §8.1 measured ~187 real GPU renders of an increasingly-large tube
scene for a 1.7M-segment file, more at opossum-scale. During preparation the user **cannot meaningfully
inspect** the final sliced/toolpath information anyway, and repeatedly rendering it is expensive —
worst on weaker machines. The product experience should be **prepare → single clean reveal**: build the
complete, correct final geometry (every extrusion segment, no segment-dropping), show **honest staged
progress** while it prepares, and reveal the finished toolpath **once** — with **no** low-quality
preliminary toolpath followed by a higher-quality rebuild. The consumer, not the renderer, chooses what
cheap visual to show during preparation.

## 2. Scope

- A first-class **single-clean-reveal** interactive build path (build all geometry, render **once** at
  completion) — generalizing today's headless-only `renderDuringBuild:false` (#375) to interactive.
- A **staged-progress** event vocabulary the consumer can render as honest status:
  `parsing → classifying → building-geometry → preparing-gpu → ready`, with a real percentage/count
  wherever the stage supports one.
- **Progressive preview stays optional** (cheap/small workloads); when used, intermediate **screen
  redraws** are throttled by a **time/render-cost budget** (not every Nth tick) — never by dropping
  geometry.
- The **contract**: the renderer exposes honest primitives + progress; **the consumer owns which
  loading presentation** (source-model / thumbnail / loading-canvas) is used per file/variant.
- (Optional, later) a **camera-handoff** affordance so a consumer that shows a live model can reveal the
  toolpath at the same pose.

## 3. Non-goals

- **Not** choosing or rendering the placeholder — the consumer owns that (§4 D4 is guidance, not code).
- **No segment-dropping degradation** — every extrusion segment is built in every mode; the tubes→lines
  ladder (DD-023, coarsen cross-section → continuous lines) is the only "degradation" and it never drops
  segments.
- **No** change to final geometry, colours, `quality`/`qualityMode`, or the DD-028 threading.
- **Not** removing progressive preview — it remains an opt-in renderer capability.

## 4. Data contracts / API

### D1 — `progressivePreview` semantics, clarified + strengthened (additive/behavioral)

`progressivePreview` becomes `'auto' | 'lines' | 'hold' | 'off'`:

- **`'auto'` (the eventual default)** = the renderer chooses **per build** between `'lines'` and `'hold'`
  based on **actual/predicted render cost + capability** (see below), **never file byte size**. Cheap
  scenes may progressively render lines; sufficiently expensive scenes take the single-reveal `'hold'`
  path automatically. An **explicit** `'lines'`/`'hold'`/`'off'` selection always **overrides** `'auto'`.
- **`'hold'` = single clean reveal.** Build the complete final geometry with **no intermediate scene
  renders**; reveal once at completion. (Strengthened: today `'hold'` suppresses the *line preview* but
  the build still renders the growing *tube* scene each tick — DD-029 suppresses those intermediate
  renders too, the true single reveal.) This is the first-class large-file experience; AnyBridge selects
  it explicitly for the product.
- **`'lines'`** = progressive line overview during the build, its intermediate redraws **budget-throttled**
  (D3), not every tick.
- **`'off'`** = no geometry preview at all; the consumer owns the loading visual. Staged progress still
  flows.

**Default migration:** the option's default stays `'lines'` initially (backward-compatible) and moves to
`'auto'` once the cost/capability estimate (below) is proven — so no consumer's behavior changes
silently on upgrade. `buildComplete` stays reveal-authoritative and `parse-progress` keeps flowing in
every mode — both are stable seam signals a consumer already depends on.

**The `'auto'` lines-vs-hold decision** uses the **same render-cost/capability estimate** DD-028 uses to
gate the worker pool (extrude-segment count × a per-segment build-cost estimate, against the detected
`RenderCapability` and memory budget) — one estimate, two consumers. A scene predicted cheap to build +
draw renders `'lines'`; one predicted expensive (where the ~187-render waste and weak-GPU cost bite)
takes `'hold'`. Crucially, this decision is **only about how often incomplete work is drawn** — it
**never** changes what geometry is built: every extrusion segment is built and the final render policy
(`quality`/`qualityMode`, the tubes→lines ladder) is untouched in every mode (§3, §12).

### D2 — Staged progress event (additive)

```ts
type PreparationStage = 'parsing' | 'classifying' | 'building-geometry' | 'preparing-gpu' | 'ready';
interface StageEvent {
  type: 'stage';
  stage: PreparationStage;
  /** 0..1 when the stage supports a real fraction; omitted when the stage is a spinner. */
  progress?: number;
  /** Optional real counts for the stage that has them. */
  detail?: { built: number; total: number };
}
```

Emitted across the pipeline: `parsing`/`classifying` from core (parse worker), `building-geometry` /
`preparing-gpu` / `ready` from the renderer. **`building-geometry` MUST carry a real `progress` + counts**
(chunks/segments built vs total) — it is the stage the user actually waits on (the opossum minute).
`parsing` carries the real fraction the parser already reports; `preparing-gpu` a fraction if available,
else a spinner; `classifying` a spinner (fast); `ready` is terminal. The event is **additive** — it does
not replace `parse-progress`/`buildComplete`; a consumer can adopt the unified vocabulary or keep the
existing events.

**Reveal-authoritative signal + terminal ordering (seam precision).** `buildComplete` remains **the
reveal-authoritative signal** — a consumer should gate its overlay-clear / colour-picker / placeholder
swap on it, unchanged. `stage:'ready'` is emitted **together with `buildComplete`** at the single reveal
(the same synchronous step: geometry complete → the one reveal render is issued → both fire), so the two
coincide and a consumer may gate on either; `buildComplete` stays the recommended one. `stage:'ready'`
is never emitted *before* `buildComplete`. There is **no `stage` failure state** — the terminal is
**exactly one of**: (success) `stage:'ready'` + `buildComplete`, or (failure) the existing structured
`error` / `parse-error` events (§6). A consumer clears its preparation overlay on **either** terminal,
so it never hangs waiting for a `buildComplete` that a failure will not send.

### D3 — Progressive redraw throttle (when `'lines'`)

Intermediate redraws are bounded by a **time/render-cost budget** — e.g. render at most once per
`progressiveRedrawBudgetMs` (default tuned, e.g. ~250 ms) **or** when accumulated build-cost since the
last draw exceeds a budget — not once per tick. **Every extrusion segment is still built**; only the
number of intermediate *draws* is bounded. `'hold'` draws zero intermediate frames.

### D4 — Consumer placeholder ladder (guidance; the consumer implements)

The renderer exposes progress + reveal; the consumer picks the cheapest **useful** placeholder it
already has:

1. **Source model — only when cheaply renderable.** A variant with an associated source model *may* show
   it while the toolpath prepares. **But the source model is not cheap for exactly the big files that
   need preparation** (AnyBridge: the opossum source `.3mf` is ~195 MB / ~5 M triangles and hits
   `E_MODEL_TOO_MANY_TRIANGLES`). So rung 1 is **gated on the model being cheaply renderable**, and a
   static **model still** is preferred over a live interactive scene (avoids two live scenes + double
   GPU/memory during prepare). Otherwise fall through.
2. **Embedded/file thumbnail — the workhorse.** Present for most files (slicer plate preview or a
   rendered one); a cheap static placeholder for the big cases where rung 1 is too expensive.
3. **Loading canvas** — when neither exists.

In all three the consumer shows the D2 staged progress as status.

### D5 — Camera-handoff (optional, later)

For the rung-1 interactive-model case only, an option to **reveal the toolpath at the placeholder's
pose** (a shared `CameraState` in / "reveal at this pose") so the reveal is not a jarring view jump. Not
needed for the static thumbnail/still rungs (a static placeholder → framed reveal is an acceptable cut).

## 5. Lifecycle

`parsing` (parse worker) → `classifying` (dialects, same worker) → IR to renderer → `building-geometry`
(build ticks; real % from chunks built vs total; **no** intermediate scene render in `'hold'`,
budget-throttled in `'lines'`) → `preparing-gpu` (first geometry upload) → **single reveal render** →
`ready`. `buildComplete` fires at the reveal; `parse-progress` flows during `parsing`.

## 6. Errors & failure behavior

A stage failure emits the existing structured error (`error` / `parse-error`, e.g. `E_GEOMETRY_BUILD`)
as the **terminal**, and **does not reveal** — neither `stage:'ready'` nor `buildComplete` fires. The
consumer keeps its placeholder (thumbnail/model/canvas) + shows the error. The `stage` event carries no
failure variant (D2): success and failure are distinguished by *which* terminal fires — `ready` +
`buildComplete` vs `error` / `parse-error` — so a consumer's overlay state machine keys off both and
never hangs on a `buildComplete` that a failed preparation will not send. No partial/incorrect toolpath
is ever presented as final. The tubes→lines degradation ladder still applies to *how* the complete
geometry is built.

## 7. Security & resource limits

None new. Suppressing intermediate renders *reduces* GPU work. No new inputs.

## 8. Performance

`'hold'` removes the ~187 intermediate growing-scene renders measured in RR-008 §8.1 — a direct,
threading-independent reduction in on-screen preparation time, largest on weaker GPUs. `'lines'` bounds
intermediate draws by the budget. Neither changes the final build cost (DD-028 addresses that).

## 9. Testing

- **Single reveal:** in `'hold'`, the stub renderer's `render()` is called **exactly once** (the reveal)
  after `buildComplete`, not per tick; the built geometry is complete (all segments) and identical to the
  progressive path's final geometry.
- **Staged progress:** `stage` events fire in order `parsing→classifying→building-geometry→preparing-gpu→
  ready`; `building-geometry` carries a monotonic `progress` + `{built,total}` reaching `total`.
- **Terminal ordering:** `stage:'ready'` coincides with `buildComplete` (never before it) on success;
  a forced stage failure emits `error`/`parse-error` and **neither** `ready` **nor** `buildComplete`
  fires — so both terminals are observable and mutually exclusive.
- **Backward-compat:** `parse-progress` and `buildComplete` still fire in every mode.
- **Redraw throttle:** in `'lines'`, intermediate render count is bounded by the budget (≪ tick count)
  while **every** extrude chunk is still built.
- **Adapter parity:** Vue/React/Svelte/Element surface the `stage` event/prop identically.
- **No segment-dropping:** all modes build the same complete segment set (assert `renderedSegmentCount`).

## 10. Migration

Additive + a clarified `'hold'`. Default stays `'lines'` (now budget-throttled — a *reduction* in
redraws, not a behavior a consumer depends on). The only `'hold'` consumer (AnyBridge, #1362) explicitly
relies on **no** per-tick geometry behavior — only on `parse-progress` + `buildComplete`, both preserved
— so strengthening `'hold'` to true single-reveal is a clean evolution. `stage` is a new opt-in event
across all four adapters. **Minor** lockstep bump. No core package depends on AnyBridge.

## 11. Observability / diagnostics

The `stage` event is the honest preparation surface. RenderStats (DD-027) can add an
`intermediateRenders` count so the render-during-build cost is visible and the `'hold'`-vs-`'lines'`
difference is measurable.

## 12. Alternatives considered

- **Keep per-tick rendering as the default** — rejected: the measured ~187-render cost with no
  inspection value (RR-008 §8.1).
- **Throttle every Nth tick** — rejected in favor of a **time/render-cost budget** (maintainer): Nth-tick
  is blind to per-tick cost, so it still over-draws on heavy ticks and under-draws on light ones.
- **Drop segments for a faster preview** — rejected: no segment-dropping degradation; the reveal is the
  complete, correct final representation.
- **Renderer picks the placeholder** — rejected: the consumer knows the file/variant relationship
  (source model? thumbnail?) and owns the presentation; the renderer only exposes primitives + progress.
- **A live source model as the default placeholder** — rejected as a default: too expensive/failure-prone
  at the scale where preparation matters (§4 D4 rung 1); thumbnail is the workhorse.

## 13. Risks

- **Adapter parity** for the `stage` event across four frameworks — mitigated by a shared parity fixture
  (as in DD-027).
- **Breaking a `'hold'` consumer** — mitigated: the sole consumer confirmed it relies only on
  `parse-progress` + `buildComplete` (preserved).
- **Deciding "cheaply renderable"** for rung 1 — a consumer concern; the DD documents the gate + the
  `E_MODEL_TOO_MANY_TRIANGLES` reality so consumers fall through to the thumbnail correctly.

## 14. Phased delivery

- **Phase A — Staged progress.** The `stage` event model in core + renderer, `building-geometry` real %,
  adapter parity. Additive; `parse-progress`/`buildComplete` untouched.
- **Phase B — Single clean reveal.** Strengthen `'hold'` to suppress intermediate scene renders
  (interactive `renderDuringBuild:false` + a final reveal); make it the recommended mode for large files.
- **Phase C — Budget-throttled progressive.** Time/render-cost-budgeted intermediate redraws for
  `'lines'`; every segment still built.
- **Phase D — `'auto'` mode.** Wire the shared render-cost/capability estimate (DD-028) to pick
  `'lines'` vs `'hold'` per build; explicit selection overrides. Flip the option default to `'auto'`
  once the estimate is proven (until then default stays `'lines'`).
- **Phase E — (optional) camera-handoff** for the rung-1 interactive-model case (D5).
- **Phase F — Docs + consumer seam.** Document the ladder + the primitives; AnyBridge wires its
  thumbnail-default placeholder + staged status + explicit `'hold'` behind its viewer.

## 15. Acceptance criteria

1. Opening a large file in `'hold'` shows staged progress, then reveals the **complete** toolpath
   **once** — **zero** intermediate growing-scene renders — with `building-geometry` reporting a real %.
2. `'lines'` bounds intermediate redraws by the time/cost budget while building **every** extrusion
   segment; `'off'` renders no preview and emits staged progress.
3. `stage` events fire in order with a real `building-geometry` percentage/count; `parse-progress` +
   `buildComplete` still fire; all four adapters surface `stage` identically.
4. No mode drops segments; the reveal is the complete, correct final representation (tubes→lines ladder
   only, never chopped). `'auto'` picks `'lines'`/`'hold'` from the render-cost/capability estimate (not
   byte size) and an explicit selection overrides it — but the built geometry is identical in every mode.
5. A consumer can drive the model-still / thumbnail / loading-canvas placeholder purely from the exposed
   primitives + progress; no renderer change is needed to pick a placeholder. No core dep on AnyBridge.
