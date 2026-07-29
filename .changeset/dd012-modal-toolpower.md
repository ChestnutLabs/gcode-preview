---
"@chestnutlabs/toolpath-core": minor
"@chestnutlabs/gcode-parser": minor
---

feat: opt-in modal tool-power channel (DD-012 phase 1 — the `ModalChannel` mechanism, #189)

Adds the shared, opt-in **`ModalChannel`** mechanism DD-012 D3 is built around, and its first channel:
**`toolPower`** — the modal spindle/laser `S` value while a tool is engaged.

- `ParseOptions.modalChannels?: readonly string[]` — request per-segment modal channels by id.
  Supported id: `'toolPower'`. Unknown ids are ignored with a `modal-channel-unsupported` warning.
- `ToolpathSegments.modal?: Readonly<Record<string, Float32Array>>` — one Float32 column per requested
  channel, present **only** when requested. An unset value is `NaN` (an honest "no value here"), never
  a fabricated `0`. `toolPower` is the modal `S` (set on `M3`/`M4` and inline on GRBL-laser motion
  lines) while engaged, `NaN` when the tool is off (`M5`).
- New capability **`toolPower`**: surfaced only when the channel is requested — `known` once a
  tool-state modal is seen, else `unavailable`.
- **Default parse pays nothing**: no `modalChannels` ⇒ no `modal` on the IR, no extra columns, FDM
  output unchanged. The budget-aware SoA writer (DD-003) grows the opt-in columns in lockstep and
  accounts their bytes.

Presentation (Watts vs RPM) is a dialect label, not a separate channel (DD-012 D4); #180's
fan/temp/accel color channels reuse this same mechanism in a later phase.
