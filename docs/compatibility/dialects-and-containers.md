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
| PrusaSlicer | **full** (header; tail settings) | **full** (`;TYPE:` → roles, `known`) | — (Prusa object comments: phase 5) | **partial** (`bed_shape` → rect/polygon, `inferred`) | — | **full** (bounded `; thumbnail` blocks) | `dialect-prusa-style` | 2026-07-23 |
| OrcaSlicer / Bambu Studio | **full** (header; container metadata) | **full** (`; FEATURE:` → roles, `known`) | **full** (start/stop printing object → `objects: known`) | **partial** (`printable_area` `inferred`; container config `known` outranks) | **partial** (container filaments) | container PNGs (phase 5) | `dialect-orca-bambu-style`, `container-mini-project` | 2026-07-23 |
| Cura | **full** (`Cura_SteamEngine` header) | **full** (`;TYPE:` UPPERCASE → roles, `known`) | — | **unsupported** (machine size lives in the packed settings blob — v1 non-goal) | — | — | `dialect-cura-style` | 2026-07-23 |
| Slic3r-family (legacy) | _unplanned_ | — | — | — | — | — | — | — |

## Dialects (firmware flavor — composes with slicer adapters)

| Dialect | Detection | Object exclusion | Notes | Fixtures | Evidence date |
|---|---|---|---|---|---|
| Klipper | **full** (`EXCLUDE_OBJECT_*`/macros head; `gcode_flavor` tail) | `EXCLUDE_OBJECT_*` semantics: _phase 5_ | composes with slicer adapters (proven: PrusaSlicer+Klipper) | `dialect-klipper-prusa` | 2026-07-23 |
| Marlin | **full** (`;FLAVOR:Marlin`; `gcode_flavor` tail) | `M486` semantics: _phase 5_ | composes (proven: Cura+Marlin) | `dialect-cura-style` | 2026-07-23 |
| RepRap-style | **full** (`;FLAVOR:RepRap`; `gcode_flavor` tail) | — | detection-only | `dialect-reprap-style` | 2026-07-23 |

## Containers

| Container | Discovery | Plates | Machine metadata | Integrity checks | Security review | Fixtures | Evidence date |
|---|---|---|---|---|---|---|---|
| `.gcode.3mf` (Orca/Bambu) | **full** (magic sniff + CD walk) | **full** (multi-plate lifecycle, `{plate}` select, default-0 + warning) | **full** (`printable_area`/`printable_height`/printer/filaments → `MachineGeometry`, `known`) | **full** (CRC32, header agreement, encryption/zip64 rejection, duplicates, incremental caps) | [record prepared — awaiting sign-off](../design/SECURITY-REVIEW-DD-005-containers.md) | `container-mini-project` + 7 adversarial | 2026-07-23 |
| `.bgcode` (Prusa binary) | _separate DD (non-goal here)_ | — | — | — | — | — | — |

## Cross-cutting coverage

| Capability | Mechanism | Status |
|---|---|---|
| Multi-tool / AMS / IDEX | tool metadata via adapters | _phase 5_ |
| Arc moves (G2/G3) | core parser (golden-gated) | **full** since E2 |
| Per-file build plate in the viewer | `metadata.machine` → `setBuildVolume` (DD-005 §4.2) | mechanism shipped (phase 1); data arrives phases 2–3 |
