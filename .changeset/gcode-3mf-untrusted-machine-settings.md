---
'@chestnutlabs/gcode-containers': patch
---

A `.gcode.3mf` with impossible machine settings no longer gives an infinite bed or a zero or negative
build height. Backslash plate names now get the right order and thumbnails.

Opening the file never fails because of these values. The bad value is left out, and
`metadata.warnings` gets a `container-metadata-invalid` warning. The parse result shows that warning
with the other container warnings. What changed in `Metadata/project_settings.config` handling:

- **Bed.** A `printable_area` point that overflows (for example 400 digits) gives no
  `metadata.machine`. Before, the bed edge was `Infinity`, which drew an infinite build volume. A
  `printable_area` that is present but unreadable (fewer than 3 or more than 64 points, or a
  malformed point) still gives no machine, and now also adds a warning. Before, it was dropped
  silently.
- **Height.** A `printable_height` that is zero, below zero, empty, text, `Infinity`, or not a
  string or number leaves `machine.heightMm` undefined. The bed itself is kept. Before, `"0"` and
  `""` gave a height of `0`, `"-5"` gave `-5`, `true` gave `1`, and `["250"]` gave `250`.
- **Not an object.** A settings file that is valid JSON but not an object (`null`, an array, a
  number) now gives the warning `project_settings.config unreadable: not a JSON object`. Before,
  `null` gave a warning with an internal `TypeError` message, and an array or number gave no warning.
- **Plate names.** A plate stored as `Metadata\plate_2.gcode` or `Metadata//plate_2.gcode` used to
  sort as plate 0, and `thumbnailsFor()` looked for `plate_0.png`. It now sorts as plate 2 and reads
  `plate_2.png`. `plates[].name` is still the name as stored in the archive.
