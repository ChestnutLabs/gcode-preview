# Design Documents (DD)

A Design Document defines the **approved implementation architecture** for one Epic or system
boundary. Architecture-sensitive work is **blocked until its DD is Accepted** (governance §4).

- Naming: `DD-NNN-<slug>.md` (e.g., `DD-001-toolpath-ir-and-capability-model.md`).
- Template: [`DD-000-template.md`](DD-000-template.md).
- Lifecycle: create the Epic → create the `DD: …` child issue → draft the DD via a docs PR → review →
  merge → mark the Epic's DD gate satisfied → begin implementation issues.
- Accepted DDs change only through a reviewable docs PR; a major reversal is an ADR or a superseding DD.

## Planned DDs (from the Master Plan §13)

| ID | Title | Epic | Milestone | Status |
|---|---|---|---|---|
| [DD-001](DD-001-toolpath-ir-and-capability-model.md) | ToolpathIR and Capability Model | E1 | M1 | **Proposed** (in review, #26) |
| [DD-002](DD-002-package-boundaries-and-public-api-versioning.md) | Package Boundaries and Public API Versioning | E1 | M1 | **Proposed** (in review, #27) |
| DD-003 | Worker Parsing, Streaming, Transfer, and Resource Limits | E2 | M2 | Planned |
| DD-004 | Three.js Rendering, Geometry, Layer Clipping, and Quality Modes | E3 | M2 | Planned |
| DD-005 | Dialect Plugin and Container Adapter Contracts | E4 | M3 | Planned |
| DD-006 | Normalized Live Progress and Source-Position Mapping | E5 | M4 | Planned |
| DD-007 | Vue Integration and AnyBridge Consumer Boundary | E6 | M4 | Planned |
| DD-008 | Package Release, Compatibility, and Deprecation Policy | E7 | M5 | Planned |
