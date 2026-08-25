# DD-022 — Instance-aware source-model rendering (GPU instancing + LOD)

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut (with Claude)
**Date:** 2026-08-25 · **Last revised:** 2026-08-25
**Owning Epic:** ModelRenderer (the DD-018 line) · **Milestone:** M3
**Supersedes / Superseded by:** none
**Related:** [DD-018](DD-018-model-renderer.md) (ModelRenderer / `ModelScene`), [DD-021](DD-021-interactive-model-viewer.md) (`createModelViewer`), [RR-006](../research/RR-006-tube-mesh-memory-and-large-file-budget.md) (the toolpath-side tube budget — the memory-degradation precedent this mirrors for meshes). Consumer/proof case: AnyBridge "View in 3D" — the `Baby_Opossum` full-sheet source `.3mf`.

> **Design frame (AnyBridge owner review, endorsed):** a full plate of instanced copies is the **normal**
> farm workload, not an exceptional one — so the answer is instancing + LOD, **explicitly NOT** "just raise
> the 5 M triangle limit." Six owner constraints (§2) plus one degradation-semantics input: the interactive
> viewer must degrade off **client** capability, not server GPU (the owner's own session is software-WebGL —
> Microsoft Basic Render Driver — so a software client must degrade harder than a hardware one; a server
> `/dev/dri` GPU only helps the headless `renderStill` path). Awaits **both-owner sign-off** before build.

> **Review log (Draft, pre-acceptance).** 2026-08-25 — AnyBridge consumption-seam review (handle-level
> consumer): §4 additive contract accepted, no objection. Three refinements folded into this draft: (1) the
> **headless path is capability-aware too** — the AnyBridge thumbnail sidecar runs headless Chromium on
> **SwiftShader** (`--use-angle=swiftshader`, software WebGL2, no `/dev/dri`), so "headless ≠ hardware"; a
> heavy hardware budget on SwiftShader is the OOM case this DD targets (§8/§4.3 revised); (2) disclosure
> **field parity** with the toolpath `decimationApplied` (§4.2); (3) **masked/empty** capability strings
> degrade conservatively with the DD-020 throttle as the safety net, not optimistically to hardware (§8).
> The AnyBridge owner's both-owner sign-off (§2 constraint 7) on §4 + §8 is still pending.

> **Accepted** 2026-08-25 — the **both-owner** gate (§2 constraint 7) on §4 (API/disclosure) + §8
> (degradation semantics) is **satisfied**. The **maintainer** accepted §4 + §8 as revised (additive
> instancing / LOD-decimation disclosure / `instancedCount` / `decimationApplied` / `capabilityHint` seam;
> and the revised semantics: classify software-vs-hardware from the actual WebGL renderer rather than
> assuming the host has a GPU, default the SwiftShader/headless case to a conservative software budget
> unless the consumer passes an explicit `capabilityHint`/`limits`). The **AnyBridge product owner**
> approved the same §4 + §8 as revised (relayed via the AnyBridge session), explicitly endorsing the
> headless/SwiftShader fix — "do not infer capability from the host; classify the actual renderer;
> conservative defaults for software; honor an explicit hint/limits." Cleared to build Phase 0 → Phase 1;
> the maintainer authorized proceeding autonomously (merge green increments; coordinate the consumption
> boundary with AnyBridge when Phase 1 exposes it; return only for a genuinely new public-API / safety /
> architecture decision).

---

## 1. Problem

A **source** `.3mf` for a full print sheet routinely reuses a few master meshes many times — the plate is
authored as *instances* (3MF Production-Extension `<component>` references and repeated `<build>` items),
not as N independent bodies. The measured proof case: `Baby_Opossum` full-sheet, **32 MB compressed /
195 MB uncompressed**, **two ~96 MB master meshes instanced ~40×**.

Today `parse3mf` (DD-018) **bakes every instance into independent world-space geometry** — `bakeMesh`
transforms each instance's vertices by its placement matrix and accumulates every copy into
`totalTris`. So the plate expands to **~26 M triangles**, blows the 5 M `maxTriangles` limit, and throws
`E_MODEL_TOO_MANY_TRIANGLES` — **after ~10 s of parsing** (it discovers the overflow mid-bake). The file
is *literally structured* to render as ~1.5 M unique triangles drawn many times; baking throws that away.

Three defects compound: (a) instancing is discarded, so memory/upload scales with copies, not unique
geometry; (b) there is no LOD for genuinely huge *unique* meshes; (c) the rejection is slow (parse-then-
fail) instead of a fast, clear "too big." A farm file manager showing plates hits all three constantly.

## 2. Scope

Deliver a farm-scale answer that keeps the honesty model, per the six owner constraints:

1. **Preserve shared/master geometry** wherever the 3MF uses instances/components — never bake copies to
   independent geometry.
2. **Render repeats via GPU instancing** (`InstancedMesh` per master + N transforms) where possible.
3. **LOD/decimation for genuinely huge *unique* geometry** (the non-instanced case) — a mesh-side analogue
   of the toolpath tube budget (RR-006).
4. **A hard safety ceiling as the FINAL guardrail** — after instancing + LOD, never instead of them.
5. **Fail/degrade quickly and clearly** — a byte-estimate fast-reject, not ~10 s of parsing before it
   rejects.
6. **Renderer-owned in `gcode-preview`** — no AnyBridge-only implementation; both `renderModelStill`
   (headless) and `createModelViewer` (interactive) benefit.

Plus a degradation-semantics requirement (§8): the interactive viewer's LOD/instancing thresholds must be
**client-capability aware**; the headless still path assumes a server GPU separately.

## 3. Non-goals

- **Not raising `maxTriangles` as the fix.** The ceiling stays (constraint 4); instancing + LOD are what
  make large plates renderable, not a bigger cap.
- **Not mesh simplification research.** LOD v1 is uniform triangle **decimation** with honest disclosure
  (the DD-004/RR-006 posture), not quadric-error-metric remeshing. QEM/normal-aware simplification is a
  later, separate refinement if the visual result demands it.
- **Not a new instancing format or authoring.** We *honor* the instancing the 3MF already declares; we do
  not invent instance groups the file didn't express.
- **Not changing the toolpath renderer.** This is the source-model path (`ModelScene` /
  `renderModelStill` / `createModelViewer`) only.
- **Not per-instance material overrides in v1.** Instances of a master share its geometry *and* material
  (including `paint_color` vertex colors) — which is what these files express. A future extension could
  carry per-instance color if a real file needs it (additive).

## 4. Data contracts / API

### 4.1 Instance-aware `ModelScene` (additive)

`ModelObject` gains an optional `instances` list; its `geometry` becomes **master-local** (un-baked) when
instanced. Backward compatible — a bare STL or a single-placement object is unchanged (one placement,
carried by the existing `transform`).

```ts
export interface ModelObject {
  id: string;
  name?: string;
  /** Master-local geometry. NOT world-baked when `instances` is present — the transforms place it. */
  geometry: MeshGeometry;
  /** Object→scene transform. Identity for STL; for an instanced master, this equals instances[0]
   *  (the representative placement) so existing single-transform consumers keep working. */
  transform: Mat4;
  /**
   * All scene-space placements of this master (production-extension components / repeated build items),
   * INCLUDING the first. Present only when the source reused the mesh (length ≥ 2). Absent ⇒ a single
   * placement at `transform` (today's behavior). The renderer draws one geometry upload via GPU
   * instancing across these transforms. (additive, DD-022)
   */
  instances?: Mat4[];
  material?: ModelMaterial;
  /** LOD actually applied to this object's geometry to fit the budget (absent / 1 = full detail). §4.3 */
  lod?: ModelLod;
}

/** Honest disclosure of geometry reduction (§4.3). */
export interface ModelLod {
  /** Every-Nth-triangle decimation factor applied (1 = none). */
  decimation: number;
  /** Triangles kept vs the source's own count for this object. */
  keptTriangles: number;
  sourceTriangles: number;
}
```

`ModelScene.capabilities` gains one informational tier (never fabricated):

```ts
capabilities: {
  materials: Confidence;
  transforms: Confidence;
  multiObject: Confidence;
  /** 'known' when the source declared reused/instanced geometry that the scene preserved as instances. */
  instanced: Confidence;      // (additive, DD-022)
}
```

### 4.2 Ready/result disclosure

Both surfaces disclose what was reduced, **field-parallel to the toolpath `decimationApplied`** (RR-006 /
#339) so a consumer badges model and toolpath cards the same way:

- A **flat `decimationApplied: number`** (1 = none) — the primary field, the max decimation across the
  scene's objects, named identically to the toolpath result so the "simplified for size" badge logic is
  shared. (An earlier draft exposed only a nested `lod.maxDecimation`; the AnyBridge review asked for the
  flat parallel field — the aggregate detail stays available below.)
- An optional **`lod?: { maxDecimation: number; decimatedObjects: number }`** for the multi-object detail
  (how many masters were decimated), and **`instancedCount?: number`** (total instances drawn, for an "N
  copies" badge).
- `ModelReadyInfo` (createModelViewer, DD-021 §4.2) and `RenderModelStillResult` (DD-018) gain the **same**
  three optional fields.

Capability tiers are still **passed through from the parse**, never recomputed (DD-001). Decimation is the
one place the renderer *adds* a disclosure, and it does so explicitly.

### 4.3 Budgets (renderer-owned, tunable)

New `ModelLimits` fields (defaults chosen from the RR-006 measurement discipline; the ceiling stays):

```ts
export interface ModelLimits {
  maxTriangles?: number;          // HARD ceiling, FINAL guardrail — default 5,000,000 (unchanged)
  maxObjects?: number;            // default 10,000 (unchanged)
  maxSourceBytes?: number;        // default 256 MiB (unchanged)
  /** Unique-triangle budget above which a huge UNIQUE mesh is decimated (LOD), disclosed. Instanced
   *  copies do NOT count against this (they reuse the master). Default ~2,000,000. (DD-022) */
  lodTriangleBudget?: number;
  /** Max total instances drawn across the scene (draw-call/upload bound). Default ~50,000. (DD-022) */
  maxInstances?: number;
}
```

The **hard ceiling** now measures **unique** triangles (master geometry), not baked copies — so an
instanced plate is measured at ~1.5 M, not ~26 M, and passes. A genuinely huge *unique* mesh above
`lodTriangleBudget` is decimated to fit and disclosed; only if a single unique mesh still exceeds
`maxTriangles` after LOD does it hard-reject.

**Both entry points accept these budgets per call**, and both accept a capability hint — there is no
"headless ⇒ hardware" default baked in (see §8). `renderModelStill(source, { limits, capabilityHint })`
and `createModelViewer(canvas, { limits, capabilityHint })` take the same `ModelLimits` knobs plus
`capabilityHint?: 'auto' | 'software' | 'hardware'` (default `'auto'`). A software-WebGL headless sidecar
(e.g. ANGLE→SwiftShader) is classified as software by `'auto'` and gets the software budget — or passes
`capabilityHint: 'software'` / a tighter `limits` explicitly. The knobs express **both** paths; neither is
assumed to be on a hardware GPU.

## 5. Lifecycle

The parse gains a cheap **pre-pass** before any baking:

1. **Estimate pass (fast reject, constraint 5).** Read the ZIP directory (uncompressed part sizes) + scan
   the model XML's object/component/build-item structure to compute (a) the **unique** master-triangle
   footprint and (b) the **instance count**, *without* parsing every triangle. Triangle count per part is
   estimated from the part's uncompressed byte size (3MF `<triangle>` elements are a near-constant bytes-
   per-triangle; calibrated conservatively). If the unique footprint already exceeds `maxTriangles` beyond
   what LOD can recover, or instances exceed `maxInstances`, **reject now** (`E_MODEL_TOO_MANY_TRIANGLES` /
   `E_MODEL_TOO_MANY_INSTANCES`) in well under a second.
2. **Resolve pass (instance-aware).** Walk objects/components/build-items as today, but **collect instance
   transforms per master** instead of baking a copy per placement. Each distinct master mesh is parsed
   **once** (the existing `partCache` already dedupes parts) into master-local geometry; its placements
   accumulate into `instances`.
3. **LOD pass.** For any master whose unique triangle count exceeds `lodTriangleBudget`, decimate its
   geometry (every-Nth triangle, boundary-safe where meaningful) and record `lod`.
4. **Build.** `ModelContent` (DD-021 shared scene core) builds an `InstancedMesh` for a master with
   `instances.length ≥ 2` (setting a `Matrix4` per instance) and a plain `Mesh` otherwise — the single
   shared build path both the still and the viewer already use.

Disposal, context-loss recovery, and last-wins `setSource` are unchanged (DD-021 §5) — the instanced
meshes are just more scene content the existing teardown already covers.

## 6. Errors & failure behavior

- **Fast reject** (§5.1) — `E_MODEL_TOO_MANY_TRIANGLES` (unique footprint irrecoverable) or a new
  `E_MODEL_TOO_MANY_INSTANCES`, emitted from the estimate pass, not after a full bake.
- **LOD is not an error** — it is applied silently at the geometry level but **disclosed** via `lod` /
  `ready.info.lod` (constraint: honest, never a silent quality drop).
- **Honesty tiers unchanged** — instancing is visually transparent (same result as baking), so it does not
  touch `materials`; `instanced` is purely informational. No fabricated geometry, ever.
- The hard ceiling remains the final backstop: anything past it after instancing + LOD fails cleanly.

## 7. Security & resource limits

Instancing **improves** the security posture: a malicious "zip-bomb of instances" (a tiny master
referenced millions of times) is caught by `maxInstances` in the estimate pass, cheaply, instead of an
OOM during bake. The byte-estimate reject bounds worst-case parse time. All existing DD-018 §7 limits
(source bytes, hardened container reader, no execution, no network) stand; `maxTriangles` stays as the
hard ceiling (now on unique geometry). LOD decimation bounds GPU/CPU memory for huge unique meshes the way
RR-006 bounds tube memory.

## 8. Performance & degradation semantics

- **Instancing** takes the proof case from ~26 M baked triangles (rejected) to ~1.5 M unique + ~80 instance
  transforms — one geometry upload per master, `InstancedMesh` drawing all copies in one draw call. Memory
  and upload scale with **unique** geometry, not copy count.
- **Capability-aware LOD keys off the actual renderer, not the surface.** The budget is chosen from
  whether the WebGL context is **software** or **hardware**, detected via the `UNMASKED_RENDERER_WEBGL`
  string (e.g. "SwiftShader", "Basic Render Driver", "llvmpipe" ⇒ software) — the same check on both the
  interactive and the headless path. A software context (a software-WebGL browser client **or** a headless
  `--use-angle=swiftshader` sidecar) gets a **harder** budget (lower `lodTriangleBudget`, an instance cap
  for responsiveness); a hardware context gets the full budget. `capabilityHint: 'auto'` (default) detects;
  a consumer that knows its context can pass `'software'` / `'hardware'` or tighter `limits`.
- **"Headless" is NOT assumed to be a hardware GPU** (AnyBridge review): the AnyBridge thumbnail sidecar
  deliberately runs headless Chromium on **SwiftShader** (its supported Docker default — no `/dev/dri`), so
  applying a heavy hardware budget there would reproduce the OOM/slow case on exactly the large instanced
  plates this DD targets. The still path therefore takes the **same** capability detection + `capabilityHint`
  as the viewer (§4.3), not a hardwired hardware budget. A farm sidecar that *does* have a GPU is detected
  as hardware and gets the full budget; a SwiftShader sidecar is detected as software and gets the safe one.
- **Detection is fail-safe, with DD-020 as the net.** `UNMASKED_RENDERER_WEBGL` can be empty/masked
  (privacy-hardened browsers) and a consumer generally cannot know the client GPU server-side. On a
  masked/unknown string, classify **conservatively** (lean toward the software/safer budget, never
  optimistically to hardware — an over-degraded hardware client loses some static fidelity, but a
  misclassified software client OOMs), and rely on DD-020 interaction-aware quality to keep motion
  responsive regardless. A consumer that knows better overrides via `capabilityHint`.

## 9. Testing

- **Instancing unit tests** (synthetic MIT-clean 3MF with a master referenced via components + repeated
  build items): parse yields **one** master geometry + N `instances`, `capabilities.instanced === 'known'`,
  and the *unique* triangle count (not N×) is what the ceiling measures. A non-instanced multi-object file
  still yields distinct objects.
- **Fast-reject test**: a synthetic "instance bomb" (tiny master × huge instance count) rejects from the
  estimate pass in bounded time with `E_MODEL_TOO_MANY_INSTANCES`, *without* parsing all geometry.
- **LOD test**: a synthetic huge *unique* mesh over `lodTriangleBudget` decimates and reports
  `lod.decimation > 1` / `ready.info.lod`; a small mesh reports none.
- **Render (headless-shaped, injected GL)**: `ModelContent` builds an `InstancedMesh` for an instanced
  master (instance count and per-instance matrices set) and a plain `Mesh` otherwise.
- **Capability-detect test**: a stubbed software-renderer string selects the harder interactive budget.
- **Real-file validation (uncommitted, spot-check — the grbl-hardware-log precedent):** the `Baby_Opossum`
  full-sheet `.3mf` parses to ~1.5 M unique triangles + instances (was: rejected at ~26 M) and renders.
- **Byte-for-byte guard**: STL and single-placement 3MF output is unchanged (instancing path inert).

## 10. Migration

Additive. `instances` / `lod` / `instanced` are new optional fields; a consumer reading `ModelObject.
transform` still sees the representative placement. `renderModelStill` and `createModelViewer` keep their
signatures; their options gain an optional `capabilityHint` (and both already accept `limits`), and their
result/ready types gain optional `decimationApplied` / `lod` / `instancedCount`. The **internal** change —
`parse3mf` collecting instances instead of baking, and `ModelContent` emitting `InstancedMesh` — is not a
public break. New `ModelLimits` fields default to safe values, so existing callers get the fix for free. No
new lockstep package; the work lands in `@chestnutlabs/gcode-model-renderer` (+ possibly a small helper in
the shared stage for `InstancedMesh` disposal).

## 11. Observability / diagnostics

- `ready` / result disclosure: `lod` (max decimation + how many objects decimated), `instancedCount`
  (total copies drawn), `capabilities.instanced`. A consumer surfaces "simplified for size" and/or "N
  copies" honestly.
- The estimate-pass decision (unique-triangle estimate, instance count, budget chosen, client capability)
  is available as a structured diagnostic for logging why a file was decimated / rejected / instanced.

## 12. Alternatives considered

- **Just raise `maxTriangles`** — rejected by the owner explicitly. It defers the wall (the next-bigger
  plate OOMs), scales memory with copies, and abandons the honesty/degradation model. Instancing addresses
  the actual structure of the file.
- **Bake but deduplicate identical geometry post-hoc** — still uploads N copies to the GPU and costs N×
  memory during bake; only instancing avoids the multiplication. Rejected.
- **Server-side pre-decimation only** (a sidecar down-samples before the browser sees it) — helps the
  headless still but does nothing for a `createModelViewer` frame in a software-WebGL client, which is
  exactly the owner's slow case. Client-aware LOD is required; rejected as the *sole* answer.
- **Quadric-error simplification for LOD v1** — higher visual quality but a large, separate implementation;
  uniform decimation with disclosure matches the project's established honest-degradation posture and ships
  the farm-scale fix sooner. Deferred as a refinement.
- **A new instancing-specific public type** (`ModelInstanceSet` separate from `ModelObject`) — rejected in
  favor of an additive `instances?` on `ModelObject`: less surface, backward compatible, and the master +
  placements map naturally onto one object.

## 13. Risks

- **Per-instance material / paint** — v1 shares the master's material (incl. `paint_color` vertex colors)
  across instances, which is what these files express. If a real file paints instances differently, v1
  renders them identically; §3 fences this, and per-instance color is an additive future extension.
- **Byte→triangle estimate accuracy** — the fast-reject estimate must be *conservative* (never reject a
  file that would actually fit): calibrate the bytes-per-triangle low bound from real 3MF parts, and when
  the estimate is near the ceiling, fall through to the real parse rather than reject on the estimate.
- **`InstancedMesh` + picking / draw-range** — the model viewer has no scrub/draw-range (DD-021 §3), and
  picking is not a v1 model-viewer feature, so the instancing has no interaction contract to break; if
  model picking is added later it must resolve instance id (three supports `instanceId` on raycast).
- **Capability detection variance** — `UNMASKED_RENDERER_WEBGL` strings vary by platform/driver and can be
  masked/empty on privacy-hardened browsers. Mitigate: on a masked/unknown string classify **conservatively**
  (the safer/software budget — a misclassified software client OOMs, an over-degraded hardware client only
  loses some static fidelity), lean on the DD-020 throttle as the safety net, and let a consumer force
  `capabilityHint` when it knows its context (§8).
- **Scope creep into a mesh-LOD engine** — v1 LOD is uniform decimation with disclosure; QEM/adaptive is
  explicitly out (§3).

## 14. Phased delivery

- **Phase 0 — fast byte-estimate reject.** The estimate pass + `E_MODEL_TOO_MANY_INSTANCES`, rejecting
  oversize/instance-bomb files in sub-second time instead of ~10 s. Standalone value; no API break.
- **Phase 1 — instance-aware `ModelScene` + GPU instancing.** `instances` on `ModelObject`, `parse3mf`
  collecting placements per master instead of baking, `ModelContent` emitting `InstancedMesh`, the
  `instanced` capability, and the ceiling measured on unique triangles. **This is the farm-scale fix** —
  it makes `Baby_Opossum` render. Unit + real-file validation.
- **Phase 2 — unique-mesh LOD + disclosure.** `lodTriangleBudget`, decimation of huge unique masters,
  `lod` on the object + `ready.info.lod` / result disclosure.
- **Phase 3 — client-capability-aware interactive degradation.** Software-vs-hardware detection +
  `capabilityHint`, harder interactive budgets on software clients; headless keeps the server-GPU budget.
- **Later (out of this DD)** — per-instance materials, QEM simplification, model picking with instance id.

## 15. Acceptance criteria

1. A source `.3mf` that reuses a master mesh N× parses to **one** master geometry + N `instances` (unique
   triangles ≪ N×), `capabilities.instanced === 'known'`, and renders every copy via GPU instancing — the
   `Baby_Opossum` full sheet renders instead of rejecting.
2. An oversize / instance-bomb file **fast-rejects** from the estimate pass in bounded, sub-second time
   with a structured code — no ~10 s parse-then-fail.
3. A genuinely huge **unique** mesh is **decimated** to fit `lodTriangleBudget` and the reduction is
   **disclosed** (`lod` / `ready.info.lod` / result); nothing is silently simplified.
4. The **hard `maxTriangles` ceiling remains** as the final guardrail, now measured on unique geometry,
   after instancing + LOD.
5. Degradation keys off the **actual WebGL renderer** (software vs hardware), the same way on both paths: a
   software context — a software-WebGL browser client **or** a `--use-angle=swiftshader` headless sidecar —
   uses a harder budget than a hardware context; `capabilityHint` overrides; masked/unknown classifies
   conservatively. Neither path assumes a hardware GPU. Both use the same `ModelLimits` knobs.
6. STL and single-placement 3MF output is **unchanged** (the instancing/LOD path is inert below its
   budgets); `renderModelStill` / `createModelViewer` signatures are unchanged (result/ready gain optional
   fields only).
7. The implementation is **renderer-owned** in `gcode-preview` (no AnyBridge-side mesh/instance handling);
   both owners sign off on the public-API shape (§4) and the degradation semantics (§8) before Phase 1.
