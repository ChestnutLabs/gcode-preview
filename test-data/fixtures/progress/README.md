# Progress contract fixtures (DD-006 §9, E5)

Pinned **observation sequences → expected `MappedProgress` outputs**, shaped like the real
telemetry streams surveyed in DD-006 §1.1. They are the cross-repo contract evidence: AnyBridge
consumes the same JSON in its own tests without importing this repo's code.

Planned fixtures (recorded in DD-006 **phase 2**, #91):

| Fixture | Shape (real surface it mirrors) | Exercises |
|---|---|---|
| `bambu-percent-layer.json` | Bambu MQTT `push_status`: `mc_percent` (job basis) + `layer_num`/`total_layer_num` | layer tier, job-percent band, cross-checks |
| `anycubic-percent.json` | Anycubic print report: `progress` 0–100 + `curr_layer` | percent+layer composition, minute-based timing ignored |
| `klipper-byte-fraction.json` | Moonraker client: `virtual_sdcard.progress` (byte fraction), with and without `SET_PRINT_STATS_INFO` layers | percent(bytes) promotion, conditional layer tier |
| `byte-exact.json` | Moonraker `virtual_sdcard.file_position` (future AnyBridge tier) | byte tier, identity mismatch, staleness, regression |

Each fixture is `{ meta, ir: <fixture id from test-data/manifest.json>, steps: [{ obs, expect }] }`;
degradation paths (file mismatch, stale, layer-count mismatch, regression) get explicit steps.
Phase 1 (#90) establishes this skeleton; the vitest suite in
`packages/toolpath-core/src/__tests__/` auto-extends over the JSON files once they land.
