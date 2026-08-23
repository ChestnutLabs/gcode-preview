---
"@chestnutlabs/gcode-preview-core": patch
---

Fix: `renderStill` now honors `showTravel: false` (and its documented default of false), and adds a
matching `showWipe` option (also default false).

`renderStill` only ever turned travel visibility **on** (`if (options.showTravel === true) …`), and the
renderer defaults travel (and wipe) visible — so `showTravel: false`, and omitting the option (documented
default false), were both no-ops and travel always rendered into the still. Travel and wipe visibility are
now applied unconditionally from their options, so a headless thumbnail is a clean model-only image by
default. (Retraction markers were already off by default — the renderer never enables them in a still.)

Note: this does not change camera framing. `renderStill` frames to the IR's **extrude-only** bounds
(`ir.bounds`), never the travel-inclusive bounds — so a still that still shows lines reaching the plate
corners after this fix indicates those moves are classified as extrusion, not travel (an E-mode/motion
classification question, unrelated to `showTravel`).
