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
| [DD-011](DD-011-binary-gcode-decode-adapter.md) | Binary G-code (`.bgcode`) Decode Adapter | E-bgcode (#188) | Future | **Accepted** 2026-07-27 (D1–D7 as recommended; D4 amended — metadata/thumbnails in-scope) — new `@chestnutlabs/gcode-bgcode` container adapter; heatshrink ISC-port + MeatPack clean-room (AGPL-clean, per [RR-003](../research/RR-003-bgcode-licensing-and-format-audit.md)); gated by §7.3 review + golden-equivalence |
| [DD-012](DD-012-non-extrusion-toolpath-and-modal-tool-state.md) | Non-extrusion toolpath (CNC/laser/plotter) & modal tool-state channels | #189 | Future | **Proposed** 2026-07-28 (D1–D8 open) — additive `MoveKind.Cut` + one opt-in `ModalChannel` mechanism (owns tool-state **and** #180/RR-002 color channels), canned-cycle (`G81–89`) expansion, validation-tiered dialects; per [RR-004](../research/RR-004-non-extrusion-toolpath-coverage.md) |
| [DD-013](DD-013-documentation-sdk-reference-and-published-manual.md) | Documentation, SDK Reference & Published Manual | E11 | Future | **Accepted** 2026-07-25 (D1–D7 as recommended) (#197) |
| [DD-014](DD-014-low-resource-layer-renderer.md) | Low-Resource Layer Mode (2D/adjacent-layer renderer over IR) | E8 (#9) | Future | **Accepted** 2026-07-26 (D1–D5 as recommended; D6 build-now on the AnyBridge evidence artifact) |
| [DD-016](DD-016-annotation-derived-move-kinds.md) | Annotation-Derived Move Kinds (Wipe & Seam) | E9 (#182) | Future | **Accepted** 2026-07-27 (D1–D6 as recommended; D2 = narrow additive DD-005 sink amendment so a slicer-comment signal can set `Wipe`; seam a non-goal) |

> **Reserved:** DD-015 was the candidate number for a standalone modal-state color-channels DD
> ([RR-002](../research/RR-002-modal-state-color-channels.md), #180). It is now **likely unnecessary**:
> the shared `ModalChannel` mechanism is **owned by DD-012** (above), which #180's color channels
> consume — see DD-012 §4.3. (DD-012 non-extrusion toolpath, #189, is now drafted — above.)
