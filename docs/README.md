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

## Current state (E0 — Fork Foundation & Upstream Audit)

- Fork created; `main`/`dev` established from the founding baseline; upstream history preserved.
- Inherited build/test/demo measured (recorded in [`research/`](research/) as **RR-001**).
- Next gate: **RR-001 — Upstream Baseline and Architecture Audit** must be accepted before E1 begins.
- First DDs after RR-001: **DD-001 (ToolpathIR & Capability Model)**, **DD-002 (Package Boundaries &
  Public API Versioning)**.
