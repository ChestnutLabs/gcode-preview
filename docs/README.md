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

Provenance of inherited vs. Chestnut code, the exact founding baseline, and the branch mapping are
tracked in [`UPSTREAM_PROVENANCE.md`](UPSTREAM_PROVENANCE.md).

## Current state (updated 2026-07-22 — E3 in progress)

| Epic | Status | Gate |
|---|---|---|
| **E0** Fork Foundation & Upstream Audit (#1) | **Closed/Accepted** | RR-001 **Accepted** (baseline `develop` @ `15375e56`) |
| **E1** ToolpathIR & Package Contracts (#2) | **Closed/Accepted** | DD-001 + DD-002 **Accepted** |
| **E2** Worker Parser & Large-File Pipeline (#3) | **Closed/Accepted** | DD-003 **Accepted**; all §8 benchmark targets met ([report](../tools/benchmark/results/e2-worker-benchmark-2026-07-22.md)) |
| **E3** Three.js Renderer & Viewer MVP (#4) | **Closed/Accepted** (2026-07-22) | DD-004 **Accepted + benchmark-ratified** (#61, [report](../tools/benchmark/results/e3-renderer-benchmark-2026-07-22.md)); orbit-fps budgets pending a reference-machine `perfRun()` (accepted deviation) |
| **E4** Dialect & Container Compatibility (#5) | **In progress — DD gate** | [DD-005](design/DD-005-dialect-plugin-and-container-adapter-contracts.md) **Proposed** (#70) — awaiting maintainer decisions; no implementation before acceptance + the §7.3 security-review gate |
| E5–E8 | Open, gated | DD-006…DD-008 unwritten — no implementation before each gate |

Shipped so far: `packages/toolpath-core` (SoA `ToolpathIR`, capability model), `packages/gcode-parser`
(byte-exact port of the inherited engine, worker protocol v1, streaming, limits, adversarial corpus),
`packages/gcode-renderer-three` (geometry builders + scene/lifecycle), the IR adapter (`src/ir-adapter.ts`),
golden/native fixtures + manifest with CI validation, boundary lint, license CI gate, and Vite/Electron
consumer smoke harnesses. CI (`build`) is a required check on `main`/`dev`; suite ≈275 tests.
`main` remains at the founding baseline — the first release-to-`main` flow belongs to E7/DD-008.
