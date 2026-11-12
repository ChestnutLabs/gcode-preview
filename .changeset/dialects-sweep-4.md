---
'@chestnutlabs/gcode-dialects': minor
---

Dialect annotation now reports every value it drops, accepts 8-digit filament colours, and a custom
adapter can no longer run the worker out of memory or leave half its annotations behind.

The parse still never fails because of file data. No new warning codes: everything below uses the
existing `dialect-metadata-invalid`, `dialect-annotation-truncated` and `adapter-failed` codes (in
`ir.header.warnings`, deduped with a count).

- **Filament colours.** An Orca/Bambu `filament_colour` (or a `setToolInfo` colour) of `#RRGGBBAA` now
  colours its tool. The alpha is ignored, so a `…00` colour never draws an invisible toolpath. Before,
  the tool got no colour.
- **Beds with no area.** A `bed_shape` (PrusaSlicer) or `printable_area` (Orca) whose points enclose no
  area (all the same point, or all on one line) gives no `metadata.machine`, with a
  `dialect-metadata-invalid` warning. Before, it drew a 0 × 0 build plate.
- **Cura `;TIME:`.** A value that is not a positive number gives no estimate, with a
  `dialect-metadata-invalid` warning. Before, it was dropped silently. `;TIME:0` stays silent.
- **Comment thumbnails.** A block that is over the size cap, longer than it declared, not base64, empty,
  closed with a different variant, or never closed is still dropped, and is now reported with
  `dialect-metadata-invalid`. `ThumbnailCollector` gains `close(sink)` for end of input.
- **Budgets.** When an adapter writes more thumbnails (8), raw entries (512), object names (10,000),
  filaments or tool entries (64) than the annotator keeps, the extras are dropped with one
  `dialect-annotation-truncated` warning per budget. Before, they were dropped silently.
- **Custom adapters (`AnnotationSink`).** `defineObject` accepts only a whole-number value from 1 to
  10,000 and a string name. Before, a value of 50,000,000 padded `ir.objects` until the worker ran out
  of memory. `setToolInfo` accepts only a whole-number tool of 0 or more with string fields. Before, a
  non-string colour threw and failed the whole parse. Dropped input warns `dialect-metadata-invalid`.
  Built-in adapters never produce such values: file object ids are remapped to 1..N first.
- **All or nothing.** If applying an adapter's annotations throws part-way, every IR and metadata field
  it touched is restored, and the parse records `adapter-failed` for it.
