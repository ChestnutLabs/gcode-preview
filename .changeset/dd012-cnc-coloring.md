---
"@chestnutlabs/gcode-colors": minor
"@chestnutlabs/gcode-renderer-three": minor
---

feat: non-extrusion color modes — color-by-power + cut-vs-rapid (DD-012 phase 4, #189)

Two new `ColorMode`s consuming the #189 channels (DD-012 D7):

- **`power`** — ramps each segment's modal `toolPower` (laser power / spindle RPM, the `S` value) onto
  a color ramp, the CNC/laser counterpart to color-by-speed. Auto-ranged (`toolPowerRange`) or explicit;
  `NaN` (tool off) or a file parsed without the `toolPower` channel → fallback, never a fabricated color.
  Capability-gated on `toolPower` (the Three renderer's `isColorModeAvailable` gates it).
- **`moveKind`** — cut-vs-rapid: productive moves (`Extrude` or `Cut`) vs rapids (`Travel`) — the
  "where the tool is actually working" view. Reads the always-present `kind` channel, so it is always
  available.

Both flow through `createSegmentColorer`, so the Three and Canvas-2D renderers get them for free. FDM
coloring is unchanged.
