# DD-020 — Interaction-aware render quality (progressive LOD)

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (maintainer)
**Date:** 2026-08-24 · **Last revised:** 2026-08-24
**Owning Epic:** #306 (ToolpathRenderer enhancements) · **Milestone:** M1
**Supersedes / Superseded by:** none
**Related:** DD-004 §4.3/§4.4 (quality tiers, decimation), `chooseQuality`, the `qualityFallback` event, #306 item 2.

> **Accepted 2026-08-24 (maintainer).** Design-then-build: the maintainer pre-approved implementation once
> the API is additive/backward-compatible (which it is). Build proceeds without a second approval gate.

---

## 1. Problem

`quality: 'auto'` picks tubes only at ≤ 1 M segments and lines above — a **static** cutoff, so large
plates (AnyBridge's normal workload: full/multi-object/multicolor) render permanently as flat lines even
when the client could sustain tubes at rest. `quality: 'tubes'` already prefers tubes and degrades to
lines **only** when a chunk exceeds the GPU vertex budget (`qualityFallback`) — good as a hard safety net,
but it doesn't help *interaction smoothness*: orbiting a heavy tube scene can stutter. The product goal is
**tubes at rest, smooth while interacting**, decided by the actual client runtime — not a file-size cutoff
and not the (server-side) Service-Manager host.

## 2. Scope

An **opt-in, backward-compatible** interaction-aware quality behavior on `ToolpathRenderer`:

- Prefer the built quality (tubes when the consumer asks / auto selects it) **at rest**.
- While the camera is actively moving (OrbitControls drag/zoom/keys), **temporarily reduce render detail**
  to keep interaction responsive; **restore** full detail when movement settles.
- Optionally adapt the reduction to measured **frame time** (clean and bounded — not a perf framework).
- Keep the existing hard **vertex-budget `qualityFallback`** as the final safety net (unchanged).
- Expose enough that a consumer maps a **High / Balanced / Performance** preference on top without
  reimplementing renderer logic.

## 3. Non-goals

- Not a general performance/telemetry framework; no persistent perf model, no device database.
- No Service-Manager / host-GPU input — this is the **client** interactive renderer; it reacts to the
  browser/runtime it runs in.
- v1 does **not** swap tube↔line **geometry** during interaction (that rebuild thrash is a future step if
  the pixel-ratio lever proves insufficient) — see §12.
- No change to `renderStill` (a still has no interaction) or the 2D renderer (documented no-op).
- Default behavior is unchanged (off) — existing embeds render identically.

## 4. Data contracts / API

```ts
/** Interaction-aware quality (DD-020). 'off' (default) = today's behavior. */
export type InteractionQuality = 'off' | 'auto';

interface ToolpathRendererOptions {
  // …existing…
  /** Reduce render detail while the camera moves, restore when it settles (#306/2). Default 'off'. */
  interactionQuality?: InteractionQuality;
}

class ToolpathRenderer {
  /** Toggle interaction-aware quality at runtime. */
  setInteractionQuality(mode: InteractionQuality): void;
}
```

- Threaded through `PreviewRenderer` (2D = no-op), the controller `controls.setInteractionQuality`, and all
  four adapters as an `interactionQuality` prop / `interaction-quality` attribute (parity).
- **Consumer preference mapping** (documented; the renderer does not own the three labels):
  - **High** → `quality: 'tubes'`, `interactionQuality: 'auto'`.
  - **Balanced** → `quality: 'auto'`, `interactionQuality: 'auto'`.
  - **Performance** → `quality: 'lines'`.

## 5. Lifecycle

The renderer already listens to OrbitControls `start` / `change` / `end`. When `interactionQuality: 'auto'`:

- On interaction **start** (first `change` after idle): enter interacting state; set the GL pixel ratio to
  `base × factor` (factor < 1) and re-render.
- On each `change`: re-render (at the reduced ratio). Optionally step `factor` by measured frame time (§8).
- On **end** (debounced ≈ 150 ms of no movement): restore `base` pixel ratio, reset `factor`, re-render at
  full detail.

`base` pixel ratio is the renderer's normal ratio (default 1; a consumer/host may set higher). Interaction
only scales it down transiently. Disposal/context-loss reset the state.

## 6. Errors & failure behavior

Purely presentational and bounded: if `GLRendererLike.setPixelRatio` is absent (a stub/exotic backend),
the feature is a silent no-op (the toggle still tracks state). The vertex-budget `qualityFallback` path is
independent and unchanged. No new error surface.

## 7. Security & resource limits

None — no input parsing, no allocation growth (pixel ratio only *reduces* work during interaction). Factor
is clamped to `[MIN_FACTOR, 1]` (e.g. 0.4–1.0) so it can never amplify cost.

## 8. Performance

- **Lever (v1):** during interaction, `pixelRatio = base × factor`. Fewer fragments ⇒ cheaper frames for
  fill/overdraw-bound heavy tube scenes; restored on settle so the resting image is full-resolution.
- **Frame-time adaptation (bounded):** measure `render()` wall time during interaction; if a frame exceeds a
  budget (≈ 22 ms, ~45 fps) step `factor` down one notch (min ≈ 0.4); if comfortably under (≈ 12 ms) step up
  one notch (max 1.0). A tiny hysteresis loop, not a framework — derived from the DD-004 §8 16 ms stall
  budget with interaction headroom. `Date.now()` around the single `render()` call; no rAF profiling.
- Measured against a real heavy plate on the low-resource host before acceptance (reuse the E8 benchmark
  harness).

## 9. Testing

- Unit (stub GL records `setPixelRatio`): `interactionQuality:'auto'` → pixel ratio drops on interaction
  start, restores on settle; `'off'` → never touched. Frame-time step: a slow stubbed `render` steps the
  factor down (clamped); a fast one steps up (clamped ≤ 1). Toggle at runtime works. 2D no-op.
- The default (`'off'`) leaves all existing renderer tests byte-identical.

## 10. Migration

Additive minor across `gcode-renderer-three`, `gcode-preview-core`, and the four adapters. No IR/parser
change; no golden impact. Existing consumers unaffected (default off).

## 11. Observability / diagnostics

Optional: none required for v1. (A future `quality-degraded`/`quality-restored` interaction event could
let a consumer show a "reduced detail while moving" hint — deferred; not needed to land v1.)

## 12. Alternatives considered

- **Geometry LOD (lines while moving, tubes at rest).** Most directly reduces vertex/draw-call cost, but
  requires a geometry rebuild on each interaction transition (thrash) or holding both representations
  (memory). Rejected for v1; revisit if pixel-ratio proves insufficient for vertex-bound scenes. The API
  (`interactionQuality`) is deliberately representation-agnostic so this can slot in later without a
  contract change.
- **Raise the static `auto` cutoff.** Still a static cutoff — doesn't address interaction, and forcing
  tubes on truly huge files risks the allocation limit. Rejected.
- **Consumer-owned LOD.** Rejected per the ratified direction — the perf policy is renderer-owned; the
  consumer only picks a High/Balanced/Performance preference.

## 13. Risks

- Pixel-ratio reduction helps fragment-bound more than vertex-bound scenes — mitigated by honest framing
  (it's a smoothness aid, not a silver bullet) and the representation-agnostic API that admits geometry LOD
  later. **Bring-me-back trigger:** if landing this well requires geometry-swap machinery (a materially
  bigger renderer change), that is a new architectural decision — pause and surface it.
- Frame-time hysteresis oscillation — bounded by notches + hysteresis gap + clamps.

## 14. Phased delivery

Single additive PR: renderer option + `setInteractionQuality` + pixel-ratio interaction lever + bounded
frame-time step + controls/adapters wiring + tests. (Geometry LOD, if ever needed, is a later PR under the
same API.)

## 15. Acceptance criteria

- `interactionQuality` option + `setInteractionQuality` on the renderer; `controls.setInteractionQuality`;
  prop/attribute on all four adapters; 2D no-op. Default `'off'` — no behavior change.
- With `'auto'`: verified (stub GL) that the pixel ratio drops during interaction and restores on settle,
  clamped to `[MIN_FACTOR, 1]`; frame-time step moves the factor within clamps.
- Vertex-budget `qualityFallback` unchanged; existing renderer goldens/tests unchanged.
- No core package depends on AnyBridge. Consumer High/Balanced/Performance mapping documented.
