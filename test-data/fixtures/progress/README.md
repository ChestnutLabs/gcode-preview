# Progress contract fixtures (DD-006 §9, E5)

Pinned **observation sequences → expected `MappedProgress` outputs**, shaped like the real
telemetry streams surveyed in DD-006 §1.1. They are the cross-repo contract evidence: AnyBridge
consumes the same JSON in its own tests without importing this repo's code.

Fixtures (recorded in DD-006 phase 2, #91; manifest-tracked with sha256):

| Fixture | Shape (real surface it mirrors) | Exercises |
|---|---|---|
| `bambu-percent-layer.json` | Bambu MQTT `push_status`: `mc_percent` (job basis) + `layer_num`/`total_layer_num` | layer tier, job-percent band, cross-checks |
| `anycubic-percent.json` | Anycubic print report: `progress` 0–100 + `curr_layer` | percent+layer composition, minute-based timing ignored |
| `klipper-byte-fraction.json` | Moonraker client: `virtual_sdcard.progress` (byte fraction), with and without `SET_PRINT_STATS_INFO` layers | percent(bytes) promotion, conditional layer tier |
| `byte-exact.json` | Moonraker `virtual_sdcard.file_position` (future AnyBridge tier) | byte tier, identity mismatch, staleness, regression |

Each fixture is `{ meta, irSpec, mapperOptions?, steps: [{ obs | tick, expect }] }` — `irSpec` is a
deterministic synthetic-IR recipe (layers × segsPerLayer, srcByte stride, source identity) so the
expected outputs are exact; degradation paths (file mismatch, stale, layer-count mismatch,
regression, cross-check widening) have explicit steps. The runner
`packages/toolpath-core/src/__tests__/progress-fixtures.test.ts` auto-extends over every `*.json`
here. AnyBridge consumes the same JSON (observation shapes + expectations) without importing this
repo's code.
