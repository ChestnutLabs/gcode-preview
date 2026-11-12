---
'@chestnutlabs/gcode-dialects': patch
---

Slicer comments with impossible numbers no longer put `NaN` or `Infinity` into the parse metadata.

The parse never fails because of these values. The value is left out, and the IR gets one deduped
`dialect-metadata-invalid` warning (in `ir.header.warnings`) with a count. A bed is the exception:
it keeps the existing `dialect-bed-unparsed` warning. What comes back absent now:

- **Print time.** A PrusaSlicer or Orca/Bambu time whose digits overflow (for example 400 digits
  before `s`) gives no `metadata.printEstimate`. Before, it gave `seconds: Infinity`. On a Bambu
  one-line header, a readable `model printing time` is still used when the total overflows.
- **Filament totals.** A PrusaSlicer or Orca `filament used [mm]`, `filament used [cm3]` or
  `total filament used [g]` value that is not a number (`.`, `1.2.3`) or overflows is left out of
  `metadata.filamentUsage`. Before, it was `NaN` or `Infinity`; `1.2.3` was read as `1.2`. A Cura
  `;Filament used:` that is negative or unreadable is left out too. `0` is still a valid amount.
- **Bed.** A `bed_shape` (PrusaSlicer) or `printable_area` (Orca) point that overflows gives no
  `metadata.machine`, with the existing `dialect-bed-unparsed` warning. Before, the bed edge was
  `Infinity`, which drew an infinite build volume.
- **Height.** A `max_print_height` (PrusaSlicer) or `printable_height` (Orca) of zero, below zero,
  `Infinity` or text leaves `machine.heightMm` undefined. The bed itself is kept.
- **Comment thumbnails.** A `; thumbnail begin WxH LEN` block whose width or height is outside
  1..65535 is dropped. This also applies to a `ThumbnailCollector` you use directly; it warns
  through the sink you pass in.
