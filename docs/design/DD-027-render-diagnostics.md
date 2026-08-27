# DD-027 — Render diagnostics (`RenderStats`)

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (drafted by Claude)
**Date:** 2026-08-26 · **Last revised:** 2026-08-26
**Accepted:** 2026-08-26 — public `RenderStats` shape signed off as proposed (GPU/geometry/timing/policy
field set, `getRenderStats()` + `renderStats` event, adapter parity, capability-honest `null`/`unknown`
never fabricated). Separate `renderStats` event (not folded into `ready`); a live per-frame FPS meter
and GPU-memory estimate deferred. Prioritized ahead of the remainder of DD-026 T2, which resumes after
(un-rescoped). Build authorized.
**Owning Epic:** E9/E11 (renderer options + honesty model) · **Milestone:** —
**Supersedes / Superseded by:** none
**Related:** DD-023 (capability classifier / quality policy), DD-020 (interaction quality), DD-004
(tube/line geometry), #283 (capabilities/warnings on `ready`), AnyBridge "Stats for nerds" panel

---

## 1. Problem

When a preview is slow or visibly degraded, a consumer (and a farm operator staring at a 1-minute
load on an RTX 4070) cannot tell **why** from the outside: is the context on a hardware GPU or a
software WebGL fallback (SwiftShader)? Is the time in parse, in CPU-side tube geometry build, or in
GPU upload? Did the file get decimated, and by how much? Did the tube byte budget constrain the
result? The renderer already **computes** most of these facts — `capability.ts` classifies
hardware/software from `UNMASKED_RENDERER_WEBGL`, `ChunkBuildResult` carries `decimationApplied` and
per-chunk counts, quality degradations are already disclosed — but none of it is exposed through a
stable API a UI can read. Consumers are left inferring. This DD adds one capability-honest read
surface + event so a consumer can display the actual facts (an opt-in "Stats for nerds" panel) and
stop guessing.

## 2. Scope

- A `RenderStats` snapshot type and its assembly in `@chestnutlabs/gcode-renderer-three` (the 3D
  path) and `@chestnutlabs/gcode-renderer-2d` (the Canvas path, GPU fields `null`).
- A stable `viewer.getRenderStats(): RenderStats | null` accessor + a `renderStats` event that fires
  when the snapshot changes (build complete, quality/decimation change).
- Re-emission through `@chestnutlabs/gcode-preview-core` and a matching accessor/event/prop across
  **all** framework adapters (Vue/React/Svelte/Element) so a consumer builds the panel with no
  framework-specific hacks.
- Capture of the phase timings the "why so long" question needs: `parseMs`, `geometryBuildMs`,
  `firstRenderMs`, `totalReadyMs`.

## 3. Non-goals

- **Not a profiler / flamegraph** and not a per-frame FPS overlay — no continuous per-frame sampling
  in v1 (a single coarse `lastFrameMs` may be included but the panel is a snapshot, not a live meter).
- **No UI** shipped in the library beyond a demo dogfood panel — the consumer owns the "Stats for
  nerds" surface and gates it (troubleshooting, not normal-user clutter).
- **No telemetry / no network** — stats are handed to the local consumer only; the library never
  transmits them.
- **No rendering-behavior change** — diagnostics are read-only; geometry/colours/quality axes are
  untouched.

## 4. Data contracts / API

`RenderStats` (exported from `gcode-renderer-three`; re-exported by core). Every field is either a
real measured value or `null`/`'unknown'` — **never a fabricated number** when a backend cannot
provide it.

```ts
export interface RenderStats {
  // ─── "What renderer am I actually using?" ───
  backend: '3d-webgl' | '2d-canvas';
  webglVersion: 1 | 2 | null;              // null on the 2D backend
  capability: 'hardware' | 'software' | 'unknown';  // DD-023 classifier
  gpuRenderer: string | null;              // UNMASKED_RENDERER_WEBGL, e.g. "ANGLE (NVIDIA ... RTX 4070 ..., D3D11)"
  gpuVendor: string | null;                // UNMASKED_VENDOR_WEBGL; null when the extension is gated
  // (gpuRenderer/gpuVendor are null on privacy-hardened contexts — WEBGL_debug_renderer_info absent)

  // ─── "Why did this take so long / lose quality?" ───
  geometryMode: 'tubes' | 'lines';
  sourceSegmentCount: number;              // segments in the IR
  renderedSegmentCount: number;            // segments actually built (after decimation/travel-hide)
  decimationApplied: number;               // reduction factor; 1 = nothing dropped
  vertexCount: number | null;              // summed across chunks; null if not derivable
  drawCalls: number | null;                // ~chunk count; null on 2D
  tubeBytes: number | null;                // geometry bytes for tubes; null when lines/2D
  tubeByteBudget: number | null;           // the budget in force; set when it actually constrained
  qualityMode: 'full' | 'adaptive' | 'fast';
  disclosures: string[];                   // honest degradation reasons already emitted (may be empty)

  // ─── Timings (ms; null when the phase did not run / is unmeasurable) ───
  parseMs: number | null;
  geometryBuildMs: number | null;
  firstRenderMs: number | null;
  totalReadyMs: number | null;             // parse-start → first full render
}
```

Surfacing:

- `viewer.getRenderStats(): RenderStats | null` — latest snapshot, `null` before the first build.
- `renderStats` event carrying the snapshot; fires on build complete and on any change that alters a
  field (quality/decimation change, re-decimation under budget).
- Core (`gcode-preview-core`) re-emits it as a `PreviewEvent` (`{ type: 'renderStats', stats }`) and
  exposes `controller.getRenderStats()`.
- Adapters: Vue `@render-stats` + reactive `renderStats`; React `onRenderStats` + a ref accessor;
  Svelte a `renderStats` store/callback; Element a `render-stats` CustomEvent + `getRenderStats()`.
  Same field set, same semantics, across all four.

## 5. Lifecycle

The snapshot is assembled **post-build**, in the same place the build settles (`buildComplete`), from
already-computed state: the `ChunkBuildResult` (counts, `decimationApplied`), the resolved
`geometryMode`/`qualityMode`, the disclosures already emitted, and the GPU fields read **once** at
context creation (cached — `UNMASKED_RENDERER_WEBGL` does not change for a context's life). Timings
are captured with `performance.now()` marks at parse start, build start/end, and first render.
`getRenderStats()` returns the latest immutable snapshot; a new build produces a new snapshot and one
`renderStats` emission. No runtime mutation of a returned object. Disposed viewer → `null`.

## 6. Errors & failure behavior

No new failure mode. Blind GPU detection (extension gated/absent) → `capability: 'unknown'`,
`gpuRenderer: null`, `gpuVendor: null` — never throws, never guesses. A phase that did not run yields
`null` for its timing, not `0`. Assembly is wrapped so a diagnostics failure can never break a render.

## 7. Security & resource limits

`gpuRenderer`/`gpuVendor` are device-identifying strings from `WEBGL_debug_renderer_info`; the library
only **returns** them to the consumer that already owns the WebGL context (no new exposure, no
transmission). No file paths, no source content, no PII in any field. Some browsers gate the
extension for fingerprinting reasons → honest `null`. No parsing of untrusted input; O(1) assembly.

## 8. Performance

Negligible and **not per-frame**: the snapshot is assembled once per build from values the build
already produced, plus four `performance.now()` marks. Vertex/draw counts are a sum over existing
chunk arrays (already walked at build). No measurable render regression; validate against the existing
renderer benchmark that the per-build assembly is below noise.

## 9. Testing

- **Unit (renderer):** assembly maps a synthetic `ChunkBuildResult` → expected counts/decimation;
  `geometryMode`/`qualityMode` reflected; disclosures passed through; timings monotonic and `null`
  when a phase is skipped.
- **Capability:** `classifyRenderer` already tested (hardware/software/unknown, ANGLE-wrapped,
  SwiftShader); add that `gpuRenderer` is surfaced verbatim and `null` when the extension is absent.
- **2D backend:** `backend: '2d-canvas'`, GPU fields `null`, geometry counts adapted, no throw.
- **Adapter parity:** each of Vue/React/Svelte/Element emits/exposes the same field set for the same
  input (one shared fixture asserted four ways).
- **Honesty:** no field is a fabricated `0`/empty-string where the true state is unknown.

## 10. Migration

Purely additive. New optional accessor/event/prop; no existing signature changes; **minor** lockstep
bump. No inherited xyz-tools structure touched. Consumers ignore it until they read it; AnyBridge
gains the panel data with no breaking change.

## 11. Observability / diagnostics

This DD *is* the diagnostics surface. It complements the existing capabilities/warnings-on-`ready`
(#283, which reports **IR** capabilities): `RenderStats` reports **render** facts and settles later
(build complete), so the two are deliberately separate surfaces, not merged. Privacy-preserving: no
local paths, no filenames, no source bytes.

## 12. Alternatives considered

- **Console logging only** — rejected: not consumable by a UI panel; the ask is a stable programmatic
  surface.
- **A per-frame FPS/telemetry overlay inside the library** — rejected: that is consumer UI and a
  per-frame cost; v1 is a snapshot the consumer renders on demand.
- **Fold render facts into the existing capabilities-on-`ready` event** — rejected: render stats
  settle at build-complete (after `ready`), and mixing IR capabilities with GPU/geometry/timing facts
  muddies both. Separate event, separate accessor.
- **Redefine/extend an existing event payload in place** — rejected: additive new event keeps every
  current consumer untouched.

## 13. Risks

- **GPU-string privacy gating.** `WEBGL_debug_renderer_info` may be absent → `gpuRenderer` null; the
  panel must treat `unknown`/`null` as first-class (design the field semantics for it, done above).
- **Field creep.** Keep v1 to the agreed set; a live frame-time meter and GPU-memory estimates are
  explicitly deferred.
- **Adapter drift.** Four adapters must surface identical semantics; mitigated by the shared parity
  fixture (D9).

## 14. Phased delivery

- **Phase 1 (renderer core):** `RenderStats` type + assembly + `getRenderStats()`/`renderStats` event
  in `gcode-renderer-three`; GPU fields cached at context creation; phase-timing marks. 2D backend
  fills what it can (`null` GPU).
- **Phase 2 (core seam):** `gcode-preview-core` re-emits `renderStats` and exposes
  `controller.getRenderStats()`.
- **Phase 3 (adapters):** Vue/React/Svelte/Element event + accessor + prop parity.
- **Phase 4 (dogfood + docs):** a gated "Stats for nerds" panel in `tools/demo` proving the consumer
  seam end-to-end, plus a short reference doc. AnyBridge consumes the same seam.

**Panel field priority (from the AnyBridge human-pass evidence).** The snapshot exposes every field
equally; a consumer panel should *lead* with what the human-pass found highest-value, so the default
demo panel orders them: (1) `capability` + `gpuRenderer` + `gpuVendor` — "GPU or software fallback?"
was the single question every "why slow" reduced to; (2) the parse-vs-build split `parseMs` /
`geometryBuildMs` / `totalReadyMs` (+ `firstRenderMs`) — instantly separates a slow parse from a slow
CPU tube-build, the exact axis of the streamed-build tail; (3) geometry honesty `geometryMode` /
`sourceSegmentCount` / `renderedSegmentCount` / `decimationApplied` — proves whether Detail:High is
the complete representation or silently decimated (DD-023 full-fidelity policy); (4) `qualityMode` +
`disclosures[]`; (5) deeper perf/OOM fields `drawCalls` / `vertexCount` / `tubeBytes` vs
`tubeByteBudget` last (the big-plate-OOM diagnosis). Ordering is a consumer concern, not part of the
`RenderStats` contract.

## 15. Acceptance criteria

1. On a real GPU, `getRenderStats()` post-build returns `capability: 'hardware'` and a `gpuRenderer`
   string naming the device; on a SwiftShader context, `capability: 'software'`; on a gated context,
   `'unknown'` + `gpuRenderer: null`.
2. `sourceSegmentCount`/`renderedSegmentCount`/`decimationApplied` correctly report a decimated large
   file; `tubeByteBudget` is set when (and only when) the budget constrained the build.
3. `parseMs`/`geometryBuildMs`/`firstRenderMs`/`totalReadyMs` are present and monotonic on a normal
   load; a skipped phase is `null`, never `0`.
4. All four framework adapters surface the identical field set/semantics for one shared input.
5. The 2D backend returns a valid `RenderStats` with `backend: '2d-canvas'` and `null` GPU fields.
6. No core/renderer package depends on AnyBridge; FDM geometry byte-identical (read-only feature).
