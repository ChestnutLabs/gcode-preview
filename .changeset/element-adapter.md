---
'@chestnutlabs/gcode-preview-element': minor
---

Add `@chestnutlabs/gcode-preview-element` — a framework-free `<gcode-preview>` Web Component over
`gcode-preview-core` (E9 phase 5, #149, DD-009 D5).

Attributes/properties map to the same neutral controller options and DOM `CustomEvent`s to the same
events as the Vue/React/Svelte adapters; it passes the **shared behavioral suite** (DD-007 §4.6 parity)
and joins the lockstep version line + pack-check/publint/attw gates + support matrix. Registration is a
function (`defineGcodePreview()`) so the `.` entry stays side-effect-free; import
`@chestnutlabs/gcode-preview-element/define` to auto-register. No framework peer dependency — the
plain-HTML / Angular / vanilla path.
