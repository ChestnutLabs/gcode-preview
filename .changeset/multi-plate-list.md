---
"@chestnutlabs/toolpath-core": minor
"@chestnutlabs/gcode-parser": minor
---

Surface a **structured multi-plate list** on `DialectMetadata.plates` (#306 item 3): `{ list: [{ index, name }], parsed }` — the plates discovered in a `.gcode.3mf` container and which one was parsed into this IR. A consumer can build a plate selector from data and re-parse with `parseOptions.plate` to select another, instead of scraping the `container-multiple-plates` warning string. One plate is parsed at a time — plates are never merged into one scene. Rides on the `metadata`-on-`ready` surface, so it reaches adapters with no further wiring. Absent for non-container / single-plate sources.
