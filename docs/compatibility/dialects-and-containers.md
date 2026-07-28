# Dialect & Container Compatibility Matrix

**Status:** **Published** (DD-005 §14 phase 6, issue #78, 2026-07-23) — the accumulated per-phase
evidence record. Every populated row cites a fixture in
[`test-data/manifest.json`](../../test-data/manifest.json) and carries an evidence date; current
fixtures are Chestnut-constructed synthetic marker structures (real-world redistributable samples
welcome per governance §11 and will upgrade rows in place). Benchmarks:
[E4 report](../../tools/benchmark/results/e4-dialect-container-benchmark-2026-07-23.md).

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
| Klipper | **full** (`EXCLUDE_OBJECT_*`/macros head; `gcode_flavor` tail) | **full** (`EXCLUDE_OBJECT_DEFINE/START/END` → `objects: known`, exact seg indices) | composes with slicer adapters (proven: PrusaSlicer+Klipper) | `dialect-klipper-prusa` | 2026-07-23 |
| Marlin | **full** (`;FLAVOR:Marlin`; `gcode_flavor` tail) | **full** (`M486 S<idx>`/`S-1` → `objects: known`) | composes (proven: Cura+Marlin) | `dialect-cura-style` | 2026-07-23 |
| RepRap-style | **full** (`;FLAVOR:RepRap`; `gcode_flavor` tail) | — | detection-only | `dialect-reprap-style` | 2026-07-23 |

## Containers

| Container | Discovery | Plates | Machine metadata | Integrity checks | Security review | Fixtures | Evidence date |
|---|---|---|---|---|---|---|---|
| `.gcode.3mf` (Orca/Bambu) | **full** (magic sniff + CD walk) | **full** (multi-plate lifecycle, `{plate}` select, default-0 + warning) | **full** (`printable_area`/`printable_height`/printer/filaments → `MachineGeometry`, `known`) | **full** (CRC32, header agreement, encryption/zip64 rejection, duplicates, incremental caps) | [record prepared — awaiting sign-off](../design/SECURITY-REVIEW-DD-005-containers.md) | `container-mini-project` + 7 adversarial | 2026-07-23 |
| `.bgcode` (Prusa binary) | **full** (`GCDE` magic sniff) | single plate | **partial** (`bed_shape` INI → `MachineGeometry`, `inferred`) | **full** (per-block CRC32; bounded, capped decode; DEFLATE flavor-lock) | [record prepared — awaiting sign-off](../design/SECURITY-REVIEW-DD-011-bgcode.md) | `prim-cube` golden pair + adversarial fuzz corpus | 2026-07-27 |

## Cross-cutting coverage

| Capability | Mechanism | Status |
|---|---|---|
| Multi-tool / AMS / IDEX | core `tool` channel (T commands) + adapter `filament_type/colour` → `ir.tools` material/color | **full** (`dialect-multitool-ams`, 2026-07-23) |
| Arc moves (G2/G3) | core parser (golden-gated) | **full** since E2 |
| Per-file build plate in the viewer | `metadata.machine` → `setBuildVolume` (DD-005 §4.2) | mechanism shipped (phase 1); data arrives phases 2–3 |

## Live progress tiers (DD-006, E5)

What each surveyed telemetry surface can drive on the overlay, per the DD-006 §1.1 evidence and
the [progress-signal contract](../reference/progress-signal-contract.md). "Presentation" is what
the viewer honestly shows — marker only for byte-exact.

| Surface (host-normalized) | Facts available | Best tier | Presentation | Evidence |
|---|---|---|---|---|
| Klipper / Moonraker `virtual_sdcard.file_position` | exact byte offset | byte (`known`) | marker + completed/ghost | fixture `progress-byte-exact` (2026-07-23); *unplumbed in AnyBridge today — additive upgrade* |
| Klipper / Moonraker `virtual_sdcard.progress` | byte-fraction percent (+ layers only with `SET_PRINT_STATS_INFO`) | percent-bytes promotion (`approximated`) or layer (`inferred`) | band | fixture `progress-klipper-byte-fraction` (2026-07-23) |
| Bambu MQTT `push_status` | `mc_percent` (job basis) + `layer_num`/`total_layer_num` | layer (`inferred`) | whole-layer band | fixture `progress-bambu-percent-layer` (2026-07-23) |
| Anycubic families (print report) | percent (0–100) + `curr_layer` | layer (`inferred`) / percent (`approximated`) | band | fixture `progress-anycubic-percent` (2026-07-23) |
| Any surface reporting source lines/commands | — none surveyed emit them | reserved (D3) | falls through with `line-unmapped` | DD-006 §1.1 survey |
