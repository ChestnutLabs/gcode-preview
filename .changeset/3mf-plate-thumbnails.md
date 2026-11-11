---
'@chestnutlabs/gcode-containers': patch
'@chestnutlabs/gcode-parser': patch
---

`.gcode.3mf` plate thumbnails now reach the parse result. Bambu Studio and OrcaSlicer store each plate's
preview as a PNG next to its G-code, and the parser ignored them. Parsing a `.gcode.3mf` now fills
`metadata.thumbnails` with `{ width, height, mime: 'image/png', bytes }` for the plate you parse:

- Included: `Metadata/plate_N.png`, then `Metadata/plate_N_small.png`, where the file has them.
  `top_N.png` and `pick_N.png` are not included (`pick_` is an object-id colour map, not a preview).
- It follows `parseOptions.plate`. With no plate selected you get the first plate's images.
- Width and height come from the PNG header. An image that is not a PNG, is over `maxMetadataBytes`
  (8 MiB), fails its CRC, or does not fit in what is left of the archive's expanded-size budget is
  dropped with a warning. The plate's G-code always loads first and is never affected.
- New warning code `container-thumbnail-invalid` (a plain string code; existing codes are unchanged).
  An oversize image reuses `metadata-truncated`.
- `@chestnutlabs/gcode-containers`: `OpenedContainer` gains `thumbnailsFor(plate)`, and the types
  `PlateThumbnail` / `PlateThumbnails` are exported. `plate` is the index into `plates`, not the number
  in the file name.
