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
| [DD-001](DD-001-toolpath-ir-and-capability-model.md) | ToolpathIR and Capability Model | E1 | M1 | **Accepted** 2026-07-22 (#26) |
| [DD-002](DD-002-package-boundaries-and-public-api-versioning.md) | Package Boundaries and Public API Versioning | E1 | M1 | **Accepted** 2026-07-22 (#27) |
| [DD-003](DD-003-worker-parsing-streaming-transfer-and-resource-limits.md) | Worker Parsing, Streaming, Transfer, and Resource Limits | E2 | M2 | **Accepted** 2026-07-22 with amendments (#41) |
| [DD-004](DD-004-threejs-rendering-geometry-layer-clipping-and-quality-modes.md) | Three.js Rendering, Geometry, Layer Clipping, and Quality Modes | E3 | M2 | **Accepted** 2026-07-22 (#53) |
| [DD-005](DD-005-dialect-plugin-and-container-adapter-contracts.md) | Dialect Plugin and Container Adapter Contracts | E4 | M3 | **Accepted** 2026-07-22 with amendments (#70) |
| [DD-006](DD-006-normalized-live-progress-and-source-position-mapping.md) | Normalized Live Progress and Source-Position Mapping | E5 | M4 | **Accepted** 2026-07-23 (#87) |
| [DD-007](DD-007-vue-integration-and-anybridge-consumer-boundary.md) | Vue Integration and AnyBridge Consumer Boundary | E6 | M4 | **Accepted** 2026-07-23 with amendments (#101) |
| [DD-008](DD-008-release-publication-versioning-and-support-policy.md) | Release, Publication Readiness, Versioning & Support Policy | E7 | M5 | **Accepted** 2026-07-23 with amendments (#125) |
| [DD-009](DD-009-toolpath-annotations-and-renderer-options.md) | Toolpath Annotations & Renderer Options | E9 | Future | **Accepted** 2026-07-23 (D1–D7 as recommended) (#160) |
| [DD-010](DD-010-motion-model-correctness.md) | Motion-Model Correctness (extruder/positioning mode, arc planes, coordinate systems) | E10 | Future | **Accepted** 2026-07-24 (revised D1–D6) (#191) |
| [DD-013](DD-013-documentation-sdk-reference-and-published-manual.md) | Documentation, SDK Reference & Published Manual | E11 | Future | **Accepted** 2026-07-25 (D1–D7 as recommended) (#197) |
| [DD-014](DD-014-low-resource-layer-renderer.md) | Low-Resource Layer Mode (2D/adjacent-layer renderer over IR) | E8 (#9) | Future | **Proposed** 2026-07-25 — awaiting acceptance (esp. D6 evidence gate) |

> **Reserved:** DD-011 (Binary G-code `.bgcode` decode, epic #188) and DD-012 (CNC/laser/plotter
> non-extrusion toolpaths, epic #189) are reserved by the DD-010 sibling triage and not yet drafted —
> hence the gap between DD-010 and DD-013.
