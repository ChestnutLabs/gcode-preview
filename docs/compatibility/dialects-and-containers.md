# Dialect & Container Compatibility Matrix

**Status:** Skeleton (DD-005 §14 phase 1, amendment 5) — populated by every E4 phase as evidence
accumulates; published and ratified in the final E4 phase. Every row must cite a fixture in
[`test-data/manifest.json`](../../test-data/manifest.json) and carry an evidence date.

Support levels (honest degradation per DD-001): **full** (capability `known`) · **partial**
(`inferred`/`approximated`, limitations listed) · **detected-only** (dialect identified, no
annotation) · **unsupported** (generic parse only — geometry always works; metadata absent).

## Dialects (slicer)

| Dialect | Detection | Feature roles | Objects | Bed geometry | Tools/filament | Thumbnails | Fixtures | Evidence date |
|---|---|---|---|---|---|---|---|---|
| PrusaSlicer | _phase 3_ | — | — | — | — | — | — | — |
| OrcaSlicer / Bambu Studio | _phase 3_ | — | — | — | — | — | — | — |
| Cura | _phase 4_ | — | — | — | — | — | — | — |
| Slic3r-family (legacy) | _unplanned_ | — | — | — | — | — | — | — |

## Dialects (firmware flavor — composes with slicer adapters)

| Dialect | Detection | Object exclusion | Notes | Fixtures | Evidence date |
|---|---|---|---|---|---|
| Klipper | _phase 4_ | `EXCLUDE_OBJECT_*` (_phase 5_) | — | — | — |
| Marlin | _phase 4_ | `M486` (_phase 5_) | — | — | — |
| RepRap-style | _phase 4_ | — | — | — | — |

## Containers

| Container | Discovery | Plates | Machine metadata | Integrity checks | Security review | Fixtures | Evidence date |
|---|---|---|---|---|---|---|---|
| `.gcode.3mf` (Orca/Bambu) | _phase 2_ | — | — | — | **required before release** | — | — |
| `.bgcode` (Prusa binary) | _separate DD (non-goal here)_ | — | — | — | — | — | — |

## Cross-cutting coverage

| Capability | Mechanism | Status |
|---|---|---|
| Multi-tool / AMS / IDEX | tool metadata via adapters | _phase 5_ |
| Arc moves (G2/G3) | core parser (golden-gated) | **full** since E2 |
| Per-file build plate in the viewer | `metadata.machine` → `setBuildVolume` (DD-005 §4.2) | mechanism shipped (phase 1); data arrives phases 2–3 |
