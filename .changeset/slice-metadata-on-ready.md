---
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

Surface slicer **`metadata`** on the `ready` / `parse-complete` event (#306 item 4). The
`DialectMetadata` a slicer file carries — per-tool `filaments` (`{slot, type, color, name}`),
`filamentUsage` (`{lengthMm, volumeCm3, weightG}`), `printEstimate` (`{seconds, mode}`), `thumbnails`,
`dialects`, and whitelisted `raw` settings — is now on the event across all four adapters, so a consumer
can build a "Slice details" panel without reaching into the raw handle. Capability-honest: `metadata` is
`undefined` when the file carried none, and individual fields are absent (never fabricated) when a slicer
didn't emit them. (Purge/waste, prime/tower, and cost are not parsed and are intentionally not present.)
