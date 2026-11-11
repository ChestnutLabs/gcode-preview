---
'@chestnutlabs/gcode-parser': patch
'@chestnutlabs/gcode-bgcode': patch
---

Prusa `.bgcode` thumbnails now reach the parse result. A `.bgcode` file stores its preview images as
binary blocks, not as `; thumbnail` comments. They were decoded, then dropped before the result reached
you. Parsing a `.bgcode` now fills `metadata.thumbnails` with the same `{ width, height, mime, bytes }`
entries a plain `.gcode` gets from its comments:

- `mime` is `image/png`, `image/jpeg` or `image/qoi`, from the block's format. A format id outside the
  spec is kept as `application/octet-stream`.
- Up to 8 of the file's binary thumbnails are kept, in file order. Empty thumbnail blocks are skipped.
- If the decoded G-code also carries `; thumbnail` comments, those are kept and follow the container's
  thumbnails in the list.
- The 32 MiB budget for `.bgcode` metadata and thumbnails still applies. A file over it fails with
  `E_BGCODE_BOMB`.

PrusaSlicer's own `.bgcode` files carry several thumbnails, often QOI first and PNG last. To show one
in an `<img>`, choose by `mime` instead of taking the first entry.
