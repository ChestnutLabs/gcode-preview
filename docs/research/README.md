# Research Records (RR)

A Research Record captures **reproducible evidence, comparison, or experiment** that informs a
decision. Research may precede a DD but does not bypass the DD gate (governance §5).

- Naming: `RR-NNN-<slug>.md`.
- Template: [`RR-000-template.md`](RR-000-template.md).

An RR must state: the question and the decision it informs; candidates/versions/commits tested;
environment and a reproducible procedure; the fixture/corpus manifest used; measurements and observable
results; license/provenance concerns; limitations and unknowns; and a recommendation with rejected
alternatives.

## Active / planned

| ID | Title | Epic | Status |
|---|---|---|---|
| [RR-001](RR-001-upstream-baseline-and-architecture-audit.md) | Upstream Baseline and Architecture Audit | E0 | **Complete — ready for E0 acceptance.** Baseline = `develop` @ `15375e56` (maintainer-confirmed). Benchmarks (§5.5) + reference comparison (§5.4) done; inherited red suite fixed (#23). |
| [RR-002](RR-002-modal-state-color-channels.md) | Advanced color modes via modal-state channels (fan/temp/accel/jerk/PA/flow) | E9 | **Complete (#180).** Flow + volumetric-flow are derivable free (ship as `gcode-colors` colorers); accel/fan/temp/jerk/PA need an **opt-in** modal register (~15 MB/1 M segments if always-on → gated). Recommends one capability-gated "modal state channels" subsystem, shared with the CNC/laser tool-state DD (#189). |
| [RR-003](RR-003-bgcode-licensing-and-format-audit.md) | Binary G-code (`.bgcode`) licensing & format audit | E-bgcode (#188) | **Complete (#188 phase 0).** Format v1 pinned (block/compression/encoding IDs, CRC32). Licensing: `libbgcode` + MeatPack are **AGPL** (never copy/WASM-bundle) → clean-room MeatPack; heatshrink is **ISC** → port with attribution; DEFLATE/CRC32 reuse ours. Recommends new `@chestnutlabs/gcode-bgcode` container adapter → **DD-011**, gated by a §7.3 security review + the plain-vs-`.bgcode` golden-equivalence killer test. |
| [RR-004](RR-004-non-extrusion-toolpath-coverage.md) | Non-extrusion toolpath coverage (CNC mill / laser / pen plotter) | #189 | **Complete.** Scope decision **RESOLVED — IN SCOPE** (maintainer 2026-07-28; de-risked by real-hardware validation: maintainer laser + partner CNC). Current IR mis-classifies non-extrusion work (cut/burn/draw → `Travel`, tool state dropped) but geometry is sound. Recommends **DD-012**: additive `MoveKind.Cut = 1<<7` + an **opt-in** `ModalChannel` mechanism (laser power / spindle / pen) that **also serves #180/RR-002** (one mechanism), canned-cycle (`G81–G89`) expansion, validation-**tiered** dialect honesty (`known` only when machine-verified), synthetic redistributable fixtures. |
