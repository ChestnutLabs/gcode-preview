---
"@chestnutlabs/gcode-preview-core": patch
---

Fix: `renderStill` now honors `showTravel: false` (and its documented default of false).

`renderStill` only ever turned travel visibility **on** (`if (options.showTravel === true) …`), and the
renderer defaults travel visible — so `showTravel: false`, and omitting the option (documented default
false), were both no-ops and travel always rendered into the still. Travel visibility is now applied
unconditionally from the option, so a headless thumbnail is a clean model-only image by default.

Note: this does not change camera framing. `renderStill` frames to the IR's **extrude-only** bounds
(`ir.bounds`), never the travel-inclusive bounds — so a still that still shows lines reaching the plate
corners after this fix indicates those moves are classified as extrusion, not travel (an E-mode/motion
classification question, unrelated to `showTravel`).
