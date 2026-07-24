---
name: "Design Document (DD)"
about: "Tracking issue to author and land a DD before architecture-sensitive implementation."
title: "DD-<NNN>: <decision / system>"
labels: ["type:docs", "status:needs-dd"]
---

## Decision / system
<The architecture decision this DD will settle.>

## Owning Epic & milestone
- Epic: E<N> · Milestone: M<N>

## Why a DD is required
<Which trigger from governance §4.1 applies (e.g., ToolpathIR/contract, worker protocol, public API,
dialect/container contract, rendering geometry, live-progress, compatibility, release policy,
security/limits, AnyBridge boundary).>

## Inputs & evidence to link
- Research Records: RR-<NNN>
- Prototypes / spikes: <branch/PR>
- Benchmarks / fixtures: <links>

## Deliverable
- [ ] `docs/design/DD-<NNN>-<slug>.md` drafted via a docs PR (use `DD-000-template.md`)
- [ ] Review of scope, contracts, lifecycle, errors, security, performance, tests, migration, phasing
- [ ] Merged and Epic DD gate marked satisfied

## Non-goals
<What this DD will not decide.>
