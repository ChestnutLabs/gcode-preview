# Chestnut Labs G-code Preview — Documentation

This directory holds the **founding planning set** (the controlling project plan) and the working
records the governance process produces (Design Documents, ADRs, Research Records, compatibility
evidence).

## Founding planning set — read in this order

1. [`00_PROJECT_MASTER_PLAN.md`](00_PROJECT_MASTER_PLAN.md) — vision, scope, principles, roadmap,
   success measures, Epic map. **Controls product direction.**
2. [`01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md`](01_GITHUB_WORKFLOW_PROJECT_GOVERNANCE_AND_DEVELOPMENT_PROCESS.md)
   — authoritative process. **Controls workflow; wins over other docs on process.**
3. [`02_ARCHITECTURE_AND_PACKAGE_BOUNDARIES.md`](02_ARCHITECTURE_AND_PACKAGE_BOUNDARIES.md) — system
   boundaries and dependency direction. **Controls package boundaries until a DD/ADR changes them.**
4. [`03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md`](03_UPSTREAM_FORK_LICENSE_AND_CONTRIBUTION_POLICY.md)
   — fork relationship, upstream adoption, MIT attribution, provenance.
5. [`04_GITHUB_BOOTSTRAP_EPICS_MILESTONES_AND_NEXT_STEPS.md`](04_GITHUB_BOOTSTRAP_EPICS_MILESTONES_AND_NEXT_STEPS.md)
   — repository/GitHub bootstrap, Epics, milestones, labels, issue hierarchy.
6. [`05_ANYBRIDGE_HANDOFF.md`](05_ANYBRIDGE_HANDOFF.md) — deferring the viewer out of AnyBridge
   `#593`/`#581` without losing or duplicating work.

See also [`../PROJECT_SETUP.md`](../PROJECT_SETUP.md) for the local environment and private-source
(`ProjectSource/`) handling.

> These documents do **not** authorize implementation, package publication, or AnyBridge integration.
> The first executable work is repository bootstrap and research/audit (E0). Each architecture-sensitive
> Epic must pass its Design Document gate before its first implementation issue begins.

## Working records

| Directory | Artifact | Naming |
|---|---|---|
| [`design/`](design/) | Design Documents (DD) — approved implementation architecture for one Epic/boundary | `DD-NNN-<slug>.md` |
| [`adr/`](adr/) | Architecture Decision Records — one durable decision and its consequences | `ADR-NNN-<slug>.md` |
| [`research/`](research/) | Research Records — reproducible evidence, comparison, or experiment | `RR-NNN-<slug>.md` |
| [`compatibility/`](compatibility/) | Compatibility/support matrices with evidence and dates | `<topic>.md` |
| [`reference/`](reference/) | Consumer-facing contract references and integration notes | `<topic>.md` |

Provenance of inherited vs. Chestnut code, the exact founding baseline, and the branch mapping are
tracked in [`UPSTREAM_PROVENANCE.md`](UPSTREAM_PROVENANCE.md).

## Current state (updated 2026-07-29 — v0.3.0 shipped to npm; v0.4.0 in prep; #188 bgcode closed; #189 CNC/laser phases 1–5 built + real-file lexer/detection; #152 STL export done)

| Epic | Status | Gate |
|---|---|---|
| **E0** Fork Foundation & Upstream Audit (#1) | **Closed/Accepted** | RR-001 **Accepted** (baseline `develop` @ `15375e56`) |
| **E1** ToolpathIR & Package Contracts (#2) | **Closed/Accepted** | DD-001 + DD-002 **Accepted** |
| **E2** Worker Parser & Large-File Pipeline (#3) | **Closed/Accepted** | DD-003 **Accepted**; all §8 benchmark targets met ([report](../tools/benchmark/results/e2-worker-benchmark-2026-07-22.md)) |
| **E3** Three.js Renderer & Viewer MVP (#4) | **Closed/Accepted** (2026-07-22) | DD-004 **Accepted + benchmark-ratified** (#61, [report](../tools/benchmark/results/e3-renderer-benchmark-2026-07-22.md)); orbit-fps budgets pending a reference-machine `perfRun()` (accepted deviation) |
| **E4** Dialect & Container Compatibility (#5) | **Closed/Accepted** (2026-07-23) | [DD-005](design/DD-005-dialect-plugin-and-container-adapter-contracts.md) **Accepted + benchmark-ratified** incl. the container-threshold ratification; [§7.3 security review signed off](design/SECURITY-REVIEW-DD-005-containers.md); [matrix published](compatibility/dialects-and-containers.md) ([report](../tools/benchmark/results/e4-dialect-container-benchmark-2026-07-23.md)) |
| **E5** Live Progress Mapping (#6) | **Closed/Accepted** (2026-07-23) | [DD-006](design/DD-006-normalized-live-progress-and-source-position-mapping.md) **Accepted** (D1–D5 as proposed, D3 clarified) with real AnyBridge telemetry evidence; all 5 phases merged (#90–#94); [contract reference](reference/progress-signal-contract.md) + [consumer notes](reference/progress-consumer-notes.md) published; §8 budgets **all PASS** ([report](../tools/benchmark/results/e5-progress-benchmark-2026-07-23.md)); GPU ghost-overdraw on the reference-machine list |
| **E6** Vue Package & AnyBridge Consumer Integration (#7) | **Closed/Accepted** (2026-07-23) | [DD-007](design/DD-007-vue-integration-and-anybridge-consumer-boundary.md) **Accepted** (D1 amended: first-class Vue/React/Svelte adapters over shared `gcode-preview-core`); all 8 phases merged; shared behavioral suite green ×3; consumer tarball fixture in CI; [evidence + parity table](../tools/benchmark/results/e6-multiframework-evidence-2026-07-23.md); AnyBridge #783 cross-linked with the consumption recipe |
| **E7** Release, Documentation & Ecosystem (#8) | **Closed/Accepted** (2026-07-24) | [DD-008](design/DD-008-release-publication-versioning-and-support-policy.md) **Accepted** with amendments; all seven phases merged. **`v0.1.0` published to npm** — all nine `@chestnutlabs/*` packages (lockstep, provenance) from the `v0.1.0` tag on `main`; both §15 gates met (framework parity ×3 + registry-mode verification); [exit report](../tools/benchmark/results/e7-exit-v0.1.0-release-2026-07-24.md). `main` promoted off the founding baseline |
| **E9** Toolpath Annotations & Renderer Options (#162) | **Closed/Accepted** (2026-07-24) | [DD-009](design/DD-009-toolpath-annotations-and-renderer-options.md) **Accepted** (D1–D7; D1 + D2 amended at implementation). **All items shipped in `v0.2.0`:** retraction markers (#148, D1), orthographic camera (#150, D3), M600 color-change (#147, D2 — parser-detected sparse `colorChanges` channel), bounded theming API (#153, D4), Custom Element `@chestnutlabs/gcode-preview-element` (#149, D5 — new 10th lockstep package). Multi-gcode = [documented mount-multiple workaround](reference/multi-gcode-previews.md) (#151, D6). Epic #162 closed |
| **E10** Motion-Model Correctness (#191) | **Closed/Accepted** (2026-07-25) | [DD-010](design/DD-010-motion-model-correctness.md) **Accepted** (D1–D6; D4 amended for probe awareness). **All audit gaps closed:** phase 1 — M82/M83 + G90/G91 + G92 E-datum (#156/#155); phase 2 — arc planes G17/G18/G19 (#157); phase 3 — coordinate systems G53/G54–G59/G10 + G92 XYZ + **probe-aware datum** (`G31` → `probe-position-runtime-dependent`, post-probe `G92` = logical resync) (#158). New capabilities `extrusionMode`/`positioningMode`/`arcPlanes`/`coordinateSystem`; identity-WCS/XY corpus byte-identical (the `mach3` plasma fixture an intentional documented divergence). Sibling DDs still reserved: `.bgcode` (#188→DD-011), CNC/laser (#189→DD-012) |
| Renderer color/viz backlog (#177–#185) | **Closed** (2026-07-27) | Additive capability-gated modes over already-parsed IR channels (DD-009 pattern, no new DD). **All shipped:** color-by-speed (#177), color-by-object (#178), color-by-layer-height (#179); seam/wipe move visibility (#182 → [DD-016](design/DD-016-annotation-derived-move-kinds.md)); filled build-plate surface (#185); filament/time metadata (#183) with time-based scrub + print-time estimate (#181); source-line ↔ segment debugger surface (#184). Advanced modal-channel color research (#180) recorded as [RR-002](research/RR-002-modal-state-color-channels.md) |
| **E11** Documentation, SDK Reference & Published Manual (#197) | **Closed/Accepted** (2026-07-25) | [DD-013](design/DD-013-documentation-sdk-reference-and-published-manual.md) **Accepted** (D1–D7 as recommended). Completed E7/DD-008's docs ambit. **All four phases shipped:** typedoc API reference over the ten packages (#198), GitHub Pages + Chestnut Labs theme (#199), SDK manual — getting-started/guides/concepts (#200), accuracy gate + `eslint-plugin-tsdoc` + version stamp (#201). **Live: [chestnutlabs.github.io/gcode-preview](https://chestnutlabs.github.io/gcode-preview/)** (manual at `/`, API at `/api/`), auto-redeployed on merge/release. No package/IR/renderer change. Deferred: flip the `notDocumented` doc-coverage check to error once the 55 TSDoc-syntax gaps are filled |
| **E8** Low-Resource Layer Mode (#9) | **Closed/Accepted** (2026-07-26) | [DD-014](design/DD-014-low-resource-layer-renderer.md) **Accepted** (D1–D5 as recommended; D6 build-now on the standing AnyBridge evidence). **All four §14 phases shipped** — #212 two new lockstep pkgs (`gcode-colors` shared ColorMode subsystem + `gcode-renderer-2d` Canvas 2D `LayerView2D`, no `three`/framework; renderer-three refactored onto the shared colorer) → **12 packages**; #213 adjacent "ghost" layers over a stable model frame; #214 **`renderer: '2d' \| '3d'` prop** through core + all 4 adapters (the 3D renderer is **loaded on demand** so a 2D-only bundle never ships Three.js) + 2D live-progress "cut"; #215 capability-honesty disclosures (non-planar/CNC via `renderer-unsupported`) + **§8 low-resource budget verified on a real device** (redraw ~0.2 ms median, ≤ 3.6 ms @ 6× CPU throttle vs the 16 ms budget; ~0 MB heap growth over 870 renders — no per-layer geometry) ([report](../tools/benchmark/results/e8-2d-lowresource-benchmark-2026-07-26.md)). §15 acceptance criteria met. Roadmap note (DD-008 §4.8): pure-Node GPU-less still rendering is a related deferred capability |
| **Binary G-code (`.bgcode`) decode** (#188) | **Closed/Accepted** (2026-07-28) | [DD-011](design/DD-011-binary-gcode-decode-adapter.md) **Accepted**, preceded by [RR-003](research/RR-003-bgcode-licensing-and-format-audit.md). New 13th lockstep pkg `@chestnutlabs/gcode-bgcode` decodes Prusa `.bgcode` → plain G-code (None / DEFLATE-zlib / heatshrink w11+w12 / MeatPack; MeatPack MIT + heatshrink ISC clean-room, no AGPL); validated against real Prusa files (21 MB XL 856/856 CRC; cube golden byte-identical); [§7 security review](design/SECURITY-REVIEW-DD-011-bgcode.md) **signed off**. **Shipped in `v0.3.0`.** |
| **Non-extrusion toolpath — CNC / laser / plotter** (#189) | **Phases 1–5 built + merged; documented; experimental tier** | [DD-012](design/DD-012-non-extrusion-toolpath-and-modal-tool-state.md) **Accepted** (D1–D8), preceded by [RR-004](research/RR-004-non-extrusion-toolpath-coverage.md). **Phases 1–5 (#248–#255):** `MoveKind.Cut` + opt-in `ModalChannel`/`toolPower`; modal-motion + canned cycles (`G81`/`G82`/`G83`); GRBL-laser/GRBL-mill/LinuxCNC dialects + **validation tiers** (experimental → claims `inferred`); color-by-power + cut-vs-rapid; [compatibility matrix](compatibility/dialects-and-containers.md#dialects-non-extrusion--cnc--laser--plotter-dd-012-189) + support docs. **Real-file work:** lexer handles multi-command lines / `N`-numbers / bare-`S` (#256 — real LinuxCNC/TinyG now parse); evidence-based detection (#258, 0/6→3/6 real samples); [STL export](../tools/demo) (#152, #257). All FDM-byte-identical. **Remaining:** phase 6 — hardware validation → promote tiers to `validated`; larger gaps (LinuxCNC O-word subroutines/params/expressions). Rides the next lockstep release (`v0.4.0`). |
| #152 STL export | Open, gated | Follows the **#118** chrome/showcase product decision, not an architecture DD (DD-009 §3) |

Shipped so far: `packages/toolpath-core` (SoA `ToolpathIR`, capability model), `packages/gcode-parser`
(byte-exact port of the inherited engine, worker protocol v1, streaming, limits, adversarial corpus),
`packages/gcode-renderer-three` (geometry builders + scene/lifecycle), the IR adapter (`src/ir-adapter.ts`),
golden/native fixtures + manifest with CI validation, boundary lint, license CI gate, and Vite/Electron
consumer smoke harnesses, plus the five framework adapters (`gcode-preview-core`/`-vue`/`-react`/
`-svelte`/`-element`). CI (`build`) is a required check on `main`/`dev`. **All ten `@chestnutlabs/*`
packages are published to npm at `v0.2.0`** (lockstep, npm provenance); `main` is the release branch,
publishing from tagged GitHub Releases (`v0.1.0` E7/DD-008, `v0.2.0` E9/DD-009). An E10-phase-1
changeset accumulates on `dev` for the next release (`0.3.0`).
